import './monacoEnv';
import { createRoot } from 'react-dom/client';
import '@patternfly/react-core/dist/styles/base.css';
import '@patternfly/react-styles/css/utilities/Spacing/spacing.css';
import '@patternfly/react-styles/css/utilities/Alignment/alignment.css';
import '@patternfly/react-styles/css/utilities/Text/text.css';
import '@patternfly/react-styles/css/utilities/Sizing/sizing.css';
import '@patternfly/react-styles/css/utilities/Display/display.css';
import '@patternfly/react-styles/css/utilities/Flex/flex.css';
import '@patternfly/react-styles/css/utilities/BackgroundColor/background-color.css';

import App from './app/App';
import { initTheme } from './app/theme';

initTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
createRoot(container).render(<App />);
