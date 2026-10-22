export function moduleVisible(config, id) {
  return !config.layout.hidden.includes(id);
}

export function publicSections(config) {
  return ['weather', 'status', 'bookmarks', 'projects'].filter((id) => moduleVisible(config, id));
}
