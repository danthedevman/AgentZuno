export function publicAsset(path) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
