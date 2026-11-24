import { useState } from 'react';
import { useWallpaper } from '../lib/background';

// Full-screen photo behind the whole app (dxexb.com style). The photo stays
// sharp at the edges; panels above it blur it with backdrop-filter, so the
// same image reads as soft color blocks and light spots inside the glass.
// If the photo fails to load, the CSS fallback gradient underneath shows.
export function BackgroundLayer() {
  const { url } = useWallpaper();
  const [loaded, setLoaded] = useState(false);
  return (
    <div aria-hidden className="app-bg">
      <div className="app-bg-fallback" />
      {url && (
        <img
          src={url}
          alt=""
          className="app-bg-img"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
      )}
      <div className="app-bg-veil" />
    </div>
  );
}
