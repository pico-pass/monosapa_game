import { createRoot } from 'react-dom/client';
import { App } from './App';
import { reloadIfOutdated } from './platform/updateCheck';
import './styles.css';

// StrictMode를 쓰지 않는다: 쓰기 탭 잠금·타이머 같은 부수효과를 이중 마운트로 두 번 실행하지 않기 위해서다.
createRoot(document.getElementById('root')!).render(<App />);

// 배포 직후 브라우저가 옛 index.html 을 쓰고 있으면 최신 화면으로 한 번 새로고침한다.
void reloadIfOutdated();
