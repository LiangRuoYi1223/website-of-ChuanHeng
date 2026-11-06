export function selectFeaturedRoutes(routes = []) {
  return routes.filter(route => route?.published === true && route.featured === true
    && !route.isDemo && !route.localDraft && !route.archived
    && typeof route.id === 'string' && route.id.trim()
    && typeof route.title === 'string' && route.title.trim());
}
