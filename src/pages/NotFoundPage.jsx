import { A } from '@solidjs/router';
export default function NotFoundPage() {
  return (
    <main class="login-page">
      <section class="empty-state">
        <h1>There’s no page here.</h1>
        <p>Your next answer is still close by.</p>
        <A href="/workspace">Open the workspace</A>
      </section>
    </main>
  );
}
