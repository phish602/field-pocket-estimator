import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { startClientFreshnessMonitoring } from './lib/serviceWorkerFreshness';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Compare this loaded hashed bundle with CRA's deployed asset manifest. This
// does not register a service worker; it only refreshes an existing EstiPaid
// registration if a previous release installed one.
const clientFreshness = startClientFreshnessMonitoring({
  serviceWorkerContainer: navigator.serviceWorker,
});

if (module.hot) {
  module.hot.dispose(() => clientFreshness.stop());
}
