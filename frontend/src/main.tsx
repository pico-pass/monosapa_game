import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// StrictMode를 쓰지 않는다: 쓰기 탭 잠금·타이머 같은 부수효과를 이중 마운트로 두 번 실행하지 않기 위해서다.
createRoot(document.getElementById('root')!).render(<App />);
