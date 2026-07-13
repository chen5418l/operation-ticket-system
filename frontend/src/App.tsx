import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import DataManagement from './pages/DataManagement';
import Forecast from './pages/Forecast';
import BoundaryJudgment from './pages/BoundaryJudgment';
import TransferDecision from './pages/TransferDecision';
import SequenceGeneration from './pages/SequenceGeneration';
import TicketGeneration from './pages/TicketGeneration';
import SafetyCheck from './pages/SafetyCheck';
import Statistics from './pages/Statistics';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/data-management" element={<DataManagement />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/boundary-judgment" element={<BoundaryJudgment />} />
          <Route path="/transfer-decision" element={<TransferDecision />} />
          <Route path="/sequence-generation" element={<SequenceGeneration />} />
          <Route path="/ticket-generation" element={<TicketGeneration />} />
          <Route path="/safety-check" element={<SafetyCheck />} />
          <Route path="/statistics" element={<Statistics />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
