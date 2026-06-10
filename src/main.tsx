import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import App from './App.tsx';

// No StrictMode: the map and globe each own a WebGL context; dev double-mount
// would needlessly create/destroy them twice.
createRoot(document.getElementById('root')!).render(<App />);
