import { NavLink, Route, Routes } from 'react-router-dom';
import Gallery from './pages/Gallery';
import Runs from './pages/Runs';
import BenchLive from './pages/BenchLive';
import Dashboard from './pages/Dashboard';
import TestReport from './pages/TestReport';

const LINKS: [string, string][] = [
  ['/', '画廊'],
  ['/tests', '测试中心'],
  ['/runs', '历次跑测'],
  ['/live', '实时看板'],
  ['/dashboard', '仪表盘'],
];

function Nav() {
  return (
    <nav className="app-nav">
      <span className="brand"><span className="dot" />企业应用示例库</span>
      {LINKS.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'cur' : '')}>
          {label}
        </NavLink>
      ))}
      <span className="spacer" />
      <span className="meta">app-library-bench</span>
    </nav>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Gallery />} />
        <Route path="/tests" element={<TestReport />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:id" element={<Runs />} />
        <Route path="/live" element={<BenchLive />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Gallery />} />
      </Routes>
    </>
  );
}
