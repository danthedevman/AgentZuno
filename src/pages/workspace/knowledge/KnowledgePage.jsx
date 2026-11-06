import { createEffect } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import KnowledgeCenterPage from './KnowledgeCenterPage.jsx';

export default function KnowledgePage() {
  const [params, setParams] = useSearchParams();
  createEffect(() => {
    if (params.tab)
      setParams(
        { tab: undefined, view: params.tab === 'articles' ? 'articles' : undefined },
        { replace: true },
      );
  });
  return <KnowledgeCenterPage />;
}
