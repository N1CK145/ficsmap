import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { ApiClientError } from './app/api.js';
import { FeaturesProvider } from './app/FeaturesContext.js';
import { ToastProvider } from './components/Toast.js';
import { FEATURES } from './features/index.js';
import { createAppRouter } from './router.js';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx will not get better by asking again; network and 5xx errors get two retries.
        retry: (failures, err) => !(err instanceof ApiClientError && err.status >= 400 && err.status < 500) && failures < 2,
      },
    },
  });
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter(FEATURES));
  return (
    <QueryClientProvider client={queryClient}>
      <FeaturesProvider features={FEATURES}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </FeaturesProvider>
    </QueryClientProvider>
  );
}
