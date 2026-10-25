// Data files resolve against the page, so the site works at a domain root
// (bike.tomstepp.com) or under a path (tomstepp.github.io/seattle-bike-now/).
// Absolute, because MapLibre fetches some of them from a worker.
export const dataUrl = (file: string) => new URL(`data/${file}`, document.baseURI).href;
