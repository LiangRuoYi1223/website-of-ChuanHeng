"""Acquire regional GEDTM30 bare earth and fresh glacier-surface Copernicus data.

The 432 GB GEDTM30 global COG is read by geographic windows; it is never
downloaded in full. Local TIFFs keep the native values, scale and grid.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, getproxies, urlopen

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'artifacts/mountain-prep/python-tools'
sys.path.insert(0, str(TOOLS))
import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds

RAW = ROOT / 'artifacts/mountain-prep/terrain-v2/raw'
MANIFEST = ROOT / 'docs/mountain-preparation/terrain-v2-download-manifest.json'
GEDTM_URL = 'https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif'
GEDTM_PAGE = 'https://zenodo.org/records/18887460'
GEDTM_NOTICE = 'Ho, Yufeng & Hengl, Tom (2026). Global Ensemble Digital Terrain Model 30m (GEDTM30), v1.2.0, OpenGeoHub, https://doi.org/10.5281/zenodo.18887460; licensed CC BY 4.0. Regional crops and subsequent meshes are modified derivatives.'
COP_NOTICE = 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved'
COP_LICENSE = 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM'
SHARED_BOUNDS = [113.94, 22.54, 114.04, 22.63]
WUTAI_BOUNDS = [113.42, 38.86, 113.72, 39.14]


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1024 * 1024):
            h.update(block)
    return h.hexdigest()


def headers(response):
    return {key: response.headers.get(key) for key in
            ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified', 'Accept-Ranges', 'Content-Type']}


def raster_info(src):
    return {'crs': str(src.crs), 'vertical_datum': 'EGM2008 (EPSG:3855), metres',
            'width': src.width, 'height': src.height, 'dtype': src.dtypes[0],
            'nodata': src.nodata, 'transform': list(src.transform)[:6],
            'bounds': list(src.bounds), 'resolution_degrees': list(src.res),
            'scale': src.scales[0], 'offset': src.offsets[0],
            'tags': src.tags(), 'area_or_point': src.tags().get('AREA_OR_POINT')}


def validate_local(path, effective_scale=None, effective_offset=None):
    with rasterio.open(path) as src:
        if src.count != 1 or src.crs.to_epsg() != 4326:
            raise ValueError('Expected single band EPSG:4326 height source')
        invalid = valid = 0
        vmin = float('inf'); vmax = -float('inf')
        for _, window in src.block_windows(1):
            a = src.read(1, window=window, masked=True)
            values = a.compressed().astype('float64') * (src.scales[0] if effective_scale is None else effective_scale) + (src.offsets[0] if effective_offset is None else effective_offset)
            if not np.isfinite(values).all():
                raise ValueError('Nonfinite source pixels')
            valid += len(values); invalid += int(a.size - len(values))
            if len(values):
                vmin = min(vmin, float(values.min())); vmax = max(vmax, float(values.max()))
        if not valid or vmin < -500 or vmax > 9000:
            raise ValueError(f'Invalid height range {vmin}, {vmax}')
        return {**raster_info(src), 'validation': {'all_local_blocks_decoded': True,
                'valid_pixels': valid, 'masked_pixels': invalid, 'height_min_m': vmin,
                'height_max_m': vmax, 'local_sha256_computed': True}}


def acquire_copernicus(tile):
    name = f'Copernicus_DSM_COG_10_{tile}_DEM'
    url = f'https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif'
    dest = RAW / f'{name}.tif'
    partial = dest.with_suffix('.tif.part')
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'Accept-Encoding': 'identity'}), timeout=90) as response:
                if response.status != 200:
                    raise ValueError('Expected HTTP 200 for entire Copernicus tile')
                meta = headers(response); expected = int(meta['Content-Length'])
                if not 1_000_000 < expected < 100_000_000:
                    raise ValueError('Unexpected regional tile length')
                received = 0
                with partial.open('wb') as f:
                    while block := response.read(1024 * 1024):
                        f.write(block); received += len(block)
                if received != expected:
                    raise ValueError('Response length mismatch')
            partial.replace(dest)
            result = {'id': f"copernicus_muztagh_N38E{tile.split('_')[2][1:]}",
                      'product': 'Copernicus GLO-30 AWS public 2021 release DSM',
                      'surface_type': 'surface_elevation_including_glacier',
                      'source_url': url, 'source_metadata_url': 'https://registry.opendata.aws/copernicus-dem/',
                      'local_path': dest.relative_to(ROOT).as_posix(), 'bytes': received,
                      'sha256': digest(dest), 'official_checksum': None,
                      'acquired_utc': now(), 'fresh_download': True, 'reused_old_file': False,
                      'acquisition_method': 'entire original one-degree GeoTIFF via HTTP 200',
                      'response': meta, 'attribution': COP_NOTICE, 'license_url': COP_LICENSE,
                      'license': 'Copernicus DEM licence; attribution required',
                      'source_resolution_m_approx': 30, 'status': 'complete', **validate_local(dest)}
            print(f"{result['id']}: downloaded and decoded {received:,} bytes", flush=True)
            return result
        except Exception:
            if partial.exists(): partial.unlink()
            if attempt == 2: raise
            time.sleep(2)


def acquire_gedtm():
    with urlopen(Request(GEDTM_URL, method='HEAD'), timeout=60) as response:
        remote_headers = headers(response)
    with urlopen(Request(GEDTM_URL, headers={'Range': 'bytes=0-15', 'Accept-Encoding': 'identity'}), timeout=60) as response:
        if response.status != 206 or not response.headers.get('Content-Range', '').startswith('bytes 0-15/'):
            raise ValueError('Global COG must support bounded HTTP ranges')
        magic = response.read(17)
        if len(magic) != 16 or magic[:4] not in (b'II\x2b\x00', b'II\x2a\x00'):
            raise ValueError('Not a verified TIFF range response')
    # Caller supplies verified CA configuration when required by Windows GDAL.
    options = {'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR', 'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tif',
               'GDAL_HTTP_TIMEOUT': '90', 'GDAL_HTTP_MAX_RETRY': '3', 'GDAL_HTTP_RETRY_DELAY': '2'}
    proxy = getproxies().get('https')
    if proxy: options['GDAL_HTTP_PROXY'] = proxy
    ca = os.environ.get('TERRAIN_GDAL_CA')
    if not ca:
        # GDAL's Windows Schannel cannot use the Chinese project path that
        # Rasterio automatically assigns to certifi. Copy the same public CA
        # bundle to an ASCII temporary path; keep certificate verification on.
        ca_path = Path(tempfile.gettempdir()) / 'chuanheng-terrain-certifi.pem'
        if not str(ca_path).isascii():
            raise ValueError('Set TERRAIN_GDAL_CA to an ASCII copy of certifi/cacert.pem')
        ca_path.write_bytes((TOOLS / 'certifi/cacert.pem').read_bytes())
        ca = str(ca_path)
    if ca:
        # Rasterio Env snapshots the old config first. Overwrite its potentially
        # non-ASCII automatic CA path before that snapshot (Windows Schannel).
        from rasterio._env import set_gdal_config
        set_gdal_config('GDAL_CURL_CA_BUNDLE', ca)
        options['GDAL_CURL_CA_BUNDLE'] = ca
        options['CURL_CA_BUNDLE'] = ca
        options['GDAL_HTTP_CAINFO'] = ca
    sources = []
    with rasterio.Env(**options):
        with rasterio.open(GEDTM_URL) as src:
            global_info = raster_info(src)
            print('GEDTM30 actual source: ' + json.dumps(global_info, ensure_ascii=True), flush=True)
            for source_id, bounds in [('gedtm30_campus_tanglang', SHARED_BOUNDS), ('gedtm30_wutai', WUTAI_BOUNDS)]:
                padded = [bounds[0] - .02, bounds[1] - .02, bounds[2] + .02, bounds[3] + .02]
                fractional = from_bounds(*padded, src.transform)
                col = math.floor(fractional.col_off); row = math.floor(fractional.row_off)
                window = Window(col, row, math.ceil(fractional.col_off + fractional.width) - col,
                                math.ceil(fractional.row_off + fractional.height) - row)
                a = src.read(1, window=window, masked=True)
                if np.ma.getmaskarray(a).any() or not np.isfinite(a.data).all():
                    raise ValueError('GEDTM regional native window has missing pixels')
                dest = RAW / f'{source_id}_native.tif'
                profile = {'driver': 'GTiff', 'width': a.shape[1], 'height': a.shape[0], 'count': 1,
                           'dtype': src.dtypes[0], 'crs': src.crs, 'transform': src.window_transform(window),
                           'nodata': src.nodata, 'compress': 'deflate', 'tiled': True,
                           'blockxsize': 256, 'blockysize': 256}
                with rasterio.open(dest, 'w', **profile) as out:
                    out.write(a.data, 1); out.scales = src.scales; out.offsets = src.offsets
                    out.update_tags(**src.tags())
                    out.update_tags(SOURCE_URL=GEDTM_URL, SOURCE_PRODUCT='GEDTM30 v1.2.0',
                                    ATTRIBUTION=GEDTM_NOTICE, CROP='Native pixel-aligned regional crop; no resampling')
                # Independently address native source pixels again (225 evenly spread samples).
                sample_count = 0
                with rasterio.open(dest) as local:
                    for r in np.linspace(0, a.shape[0] - 1, 15, dtype=int):
                        for c in np.linspace(0, a.shape[1] - 1, 15, dtype=int):
                            original = src.read(1, window=Window(col + int(c), row + int(r), 1, 1))[0, 0]
                            actual = local.read(1, window=Window(int(c), int(r), 1, 1))[0, 0]
                            if original != actual: raise ValueError('Native pixel mismatch')
                            sample_count += 1
                info = validate_local(dest, effective_scale=1.0, effective_offset=0.0)
                info['validation']['source_native_samples_exact'] = sample_count
                result = {'id': source_id, 'product': 'GEDTM30 v1.2.0 predicted bare-earth DTM',
                          'surface_type': 'estimated_bare_earth', 'source_url': GEDTM_URL,
                          'source_metadata_url': GEDTM_PAGE, 'source_resolution_m_approx': 30,
                          'source_global_properties': global_info, 'response': remote_headers,
                          'native_source_window': [col, row, int(window.width), int(window.height)],
                          'requested_bounds_wgs84': bounds, 'padded_bounds_wgs84': padded,
                          'acquisition_method': 'HTTP Range reads from global 30m COG; regional native pixel crop',
                          'global_file_downloaded': False, 'network_bytes_not_measured': True,
                          'local_path': dest.relative_to(ROOT).as_posix(), 'bytes': dest.stat().st_size,
                          'sha256': digest(dest), 'official_checksum': None,
                          'fresh_download': True, 'reused_old_file': False, 'acquired_utc': now(),
                          'attribution': GEDTM_NOTICE, 'license': 'CC BY 4.0',
                          'effective_scale': 1.0, 'effective_offset': 0.0,
                          'license_url': 'https://creativecommons.org/licenses/by/4.0/',
                          'limitations': 'Machine-learning estimate; residual tree/building heights and smoothing can remain. Not surveyed ground or 30m vertical accuracy.',
                          'status': 'complete', **info}
                sources.append(result)
                print(f'{source_id}: cropped and verified {a.shape}, {dest.stat().st_size:,} local bytes', flush=True)
    return sources


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    previously_acquired = {}
    if MANIFEST.exists():
        previous = json.loads(MANIFEST.read_text(encoding='utf-8'))
        for item in previous.get('sources', []):
            path = ROOT / item['local_path']
            if item.get('fresh_download') and path.exists() and digest(path) == item.get('sha256'):
                previously_acquired[item['id']] = item
    manifest = {'schema_version': 2, 'invocation_started_utc': now(), 'status': 'incomplete', 'sources': [],
                'checksum_scope': 'SHA256 computed locally for downloaded/copied regional files, not an official checksum or entire global GEDTM file checksum.'}
    def save():
        manifest['updated_utc'] = now()
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    save()
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = []
        for tile in ['N38_00_E074_00', 'N38_00_E075_00']:
            source_id = f"copernicus_muztagh_N38E{tile.split('_')[2][1:]}"
            if source_id in previously_acquired:
                manifest['sources'].append(previously_acquired[source_id])
            else:
                futures.append(pool.submit(acquire_copernicus, tile))
        dtm_ids = ['gedtm30_campus_tanglang', 'gedtm30_wutai']
        if all(source_id in previously_acquired for source_id in dtm_ids):
            manifest['sources'].extend(previously_acquired[source_id] for source_id in dtm_ids)
        else:
            futures.append(pool.submit(acquire_gedtm))
        errors = []
        for future in as_completed(futures):
            try:
                result = future.result()
                manifest['sources'].extend(result if isinstance(result, list) else [result])
            except Exception as error:
                errors.append(f'{type(error).__name__}: {error}')
                print(errors[-1], flush=True)
            save()
    manifest['errors'] = errors
    if manifest['sources']:
        manifest['first_source_acquired_utc'] = min(item['acquired_utc'] for item in manifest['sources'])
    for item in manifest['sources']:
        if item['id'].startswith('gedtm30_'):
            item['effective_scale'] = 1.0
            item['effective_offset'] = 0.0
            item['attribution'] = GEDTM_NOTICE
            item['scale_interpretation'] = {
                'source_band_scale_metadata': item['scale'],
                'effective_scale_to_metres': 1.0,
                'original_native_values_and_scale_tag_retained': True,
                'decision': 'Float32 values are already metres; ignore the inconsistent 0.1 band scale in this 30m COG for derived products.',
                'official_metadata': 'https://zenodo.org/records/18887460 (v1.2 Float32 terrain layer, scale 1)',
                'exact_30m_url_metadata': 'https://codeberg.org/openlandmap/GEDTM30/raw/branch/main/metadata/cog_list.csv (same URL: scale=1, Float32, unit=meter)',
                'cross_check': [
                    {'lon': 113.980943, 'lat': 22.576248, 'gedtm_raw_m': 421.6000, 'copernicus_m': 428.0511},
                    {'lon': 113.56764, 'lat': 39.08029, 'gedtm_raw_m': 3058.8999, 'copernicus_m': 3059.8291}
                ],
                'publisher_confirmation_obtained': False
            }
            # Re-read all local blocks with the documented effective units.
            prior_validation = item['validation']
            refreshed = validate_local(ROOT / item['local_path'], 1.0, 0.0)
            item['validation'] = {**prior_validation, **refreshed['validation']}
    manifest['status'] = 'complete' if len(manifest['sources']) == 4 and not errors else 'failed'
    save()
    return 0 if manifest['status'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
