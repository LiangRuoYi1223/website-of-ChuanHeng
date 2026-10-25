import { useRef, useState } from 'react';
import { api } from '../api';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';
function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('图片读取失败。'));
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.onabort = () => reject(new Error('图片读取已取消。'));
    reader.readAsDataURL(file);
  });
}
export function UploadField({
  label,
  value,
  fallbackValue,
  showPreview = true,
  onChange,
  onError,
  onBusy,
  canUpload,
}: {
  label: string;
  value: string;
  fallbackValue?: string;
  showPreview?: boolean;
  onChange: (url: string) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
  canUpload: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const previewValue = value.trim() || fallbackValue;
  return (
    <div className="admin-field admin-image-field">
      <label>
        {label}
        <input
          value={value}
          placeholder="图片路径或 https:// 链接"
          onChange={(event) => onChange(event.target.value)}
          disabled={uploading}
        />
      </label>
      {showPreview && previewValue && (
        <img
          src={previewValue}
          alt={`${label}预览${value.trim() ? '' : '（默认图片）'}`}
          loading="lazy"
          style={{ width: 130, height: 78, objectFit: 'cover', borderRadius: 4 }}
        />
      )}
      {canUpload && (
        <>
          <button
            type="button"
            className="admin-button admin-secondary"
            disabled={uploading}
            onClick={() => picker.current?.click()}
          >
            {uploading ? '上传中…' : '选择并上传图片'}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            style={{ display: 'none' }}
            onChange={async (event) => {
              const input = event.currentTarget,
                file = input.files?.[0];
              if (!file || !canUpload) return;
              if (
                !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
                !file.size ||
                file.size > 3 * 1024 * 1024
              ) {
                onError('请选择不超过 3 MB 的 JPEG、PNG 或 WebP 图片。');
                input.value = '';
                return;
              }
              setUploading(true);
              onBusy(true);
              try {
                const result = await api<{ url: string }>('/admin/upload', {
                  method: 'POST',
                  body: JSON.stringify({ filename: file.name, dataUrl: await dataUrl(file) }),
                });
                onChange(result.url);
              } catch (error) {
                onError(errorText(error));
              } finally {
                setUploading(false);
                onBusy(false);
                input.value = '';
              }
            }}
          />
        </>
      )}
      <span className="admin-help">
        {canUpload
          ? 'JPEG、PNG、WebP，最大 3 MB；上传后保存本页生效。'
          : '图片上传尚未授权，可以填写已有图片地址。'}
      </span>
    </div>
  );
}
