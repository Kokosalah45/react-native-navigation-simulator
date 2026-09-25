import { Navigate, Route, Routes } from 'react-router';
import { AppSimulator } from './components/AppSimulator';
import { TestPlan } from './components/TestPlan';

/**
 * Two routes: the simulator, and the manual test plan that covers it.
 *
 * Note for static hosting - these are real paths, not hashes, so the server
 * has to fall back to index.html for unknown paths or a refresh on /tests
 * will 404. Vite's dev server already does.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<AppSimulator />} />
      <Route path="/tests" element={<TestPlan />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
