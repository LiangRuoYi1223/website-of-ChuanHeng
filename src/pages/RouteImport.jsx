import { Navigate, useLocation } from 'react-router-dom';
import { runtimeMode } from '../runtime-mode.js';

export default function RouteImportPage() {
  const { search } = useLocation();
  const preview = runtimeMode.allowLocalPreview && new URLSearchParams(search).get('preview') === '1';
  return <Navigate to={preview ? '/admin/routes?preview=1' : '/admin/routes'} replace />;
}
