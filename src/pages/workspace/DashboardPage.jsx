import RequestsPage from './requests/RequestsPage.jsx';
export default function DashboardPage() {
  // The API returns only this person’s assignments, approvals, and permitted mentions.
  return <RequestsPage inbox />;
}
