import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { SlotProvider } from '../slots';
import { AlertProvider } from './AlertContext';
import AppRoutes from './AppRoutes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <SlotProvider slots={{}}>
      <AlertProvider>
        <BrowserRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <AppRoutes />
        </BrowserRouter>
      </AlertProvider>
    </SlotProvider>
  </QueryClientProvider>
);

export default App;
