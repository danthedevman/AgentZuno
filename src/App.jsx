import DatabaseSetupPage from './pages/DatabaseSetupPage.jsx';
import SetupPage from './pages/workspace/SetupPage.jsx';
import AuditRecordPage from './pages/workspace/AuditRecordPage.jsx';
import MyWorkPage from './pages/workspace/MyWorkPage.jsx';
import WorkspaceHomePage from './pages/workspace/WorkspaceHomePage.jsx';
import LegacyQueuePage from './pages/workspace/LegacyQueuePage.jsx';
import DocsPage from './pages/DocsPage.jsx';
import InvitePage from './pages/InvitePage.jsx';
import LegacyRequestsPage from './pages/workspace/LegacyRequestsPage.jsx';
import ApprovalsPage from './pages/workspace/ApprovalsPage.jsx';
import ArticlePreviewPage from './pages/ArticlePreviewPage.jsx';
import QueuePage from './pages/workspace/QueuePage.jsx';
import ReportsPage from './pages/workspace/ReportsPage.jsx';
import KnowledgeBasePage from './pages/workspace/KnowledgeBasePage.jsx';
import DataRecordPage from './pages/workspace/DataRecordPage.jsx';
import DataPage from './pages/workspace/DataPage.jsx';
import WorkflowBuilderPage from './pages/workspace/WorkflowBuilderPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import RequestsPage from './pages/workspace/RequestsPage.jsx';
import RequestRedirectPage from './pages/workspace/RequestRedirectPage.jsx';
import ChatRedirectPage from './pages/workspace/ChatRedirectPage.jsx';
import UsersPage from './pages/workspace/UsersPage.jsx';
import UserRecordPage from './pages/workspace/UserRecordPage.jsx';
import ConnectorsPage from './pages/workspace/ConnectorsPage.jsx';
import CatalogPage from './pages/workspace/CatalogPage.jsx';
import WorkflowsPage from './pages/workspace/WorkflowsPage.jsx';
import EditConnectionPage from './pages/workspace/EditConnectionPage.jsx';
import EditRecordPage from './pages/workspace/EditRecordPage.jsx';
import CreateTopicPage from './pages/workspace/CreateTopicPage.jsx';
import ChatPage from './pages/workspace/ChatPage.jsx';
import { Router, Route } from '@solidjs/router';
import AppLayout from './layouts/AppLayout.jsx';
import WorkspaceLayout from './layouts/WorkspaceLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import DashboardPage from './pages/workspace/DashboardPage.jsx';
import KnowledgePage from './pages/workspace/KnowledgePage.jsx';
import ArticlePage from './pages/workspace/ArticlePage.jsx';
import ContentPage from './pages/workspace/ContentPage.jsx';
import HelpPage from './pages/workspace/HelpPage.jsx';
import SearchPage from './pages/workspace/SearchPage.jsx';
import ConnectionPage from './pages/workspace/ConnectionPage.jsx';
import ConnectionsPage from './pages/workspace/ConnectionsPage.jsx';
import TasksPage from './pages/workspace/TasksPage.jsx';
import AccountPage from './pages/workspace/AccountPage.jsx';
import SourceDocumentPage from './pages/workspace/SourceDocumentPage.jsx';
import EditArticlePage from './pages/workspace/EditArticlePage.jsx';
import CreatePage from './pages/workspace/CreatePage.jsx';

export default function App() {
  return (
    <Router root={AppLayout}>
      <Route path="/" component={HomePage} />
      <Route path="/docs" component={DocsPage} />
      <Route path="/docs/workflows" component={DocsPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/preview/:workspaceId/proposals/:id" component={ArticlePreviewPage} />
      <Route path="/invite" component={InvitePage} />
      <Route path="/setup/database" component={DatabaseSetupPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path={['/workspace', '/workspace/:workspaceId', '/demo']} component={WorkspaceLayout}>
        <Route path="/" component={WorkspaceHomePage} />
        <Route path="/setup" component={SetupPage} />
        <Route path="/my-work" component={MyWorkPage} />
        <Route path="/inbox" component={DashboardPage} />
        <Route path="/requests" component={RequestsPage} />
        <Route path="/tickets" component={LegacyRequestsPage} />
        <Route path="/tickets/new" component={ChatRedirectPage} />
        <Route path="/tickets/:id" component={RequestRedirectPage} />
        <Route path="/tickets/:id/processing" component={RequestRedirectPage} />
        <Route path="/requests/new" component={ChatRedirectPage} />
        <Route path="/requests/:id/processing" component={RequestRedirectPage} />
        <Route path="/requests/:id" component={RequestRedirectPage} />
        <Route path="/data" component={DataPage} />
        <Route path="/data/:id" component={DataPage} />
        <Route path="/data/:id/records/:recordId" component={DataRecordPage} />
        <Route path="/users" component={UsersPage} />
        <Route path="/users/:userId" component={UserRecordPage} />
        <Route path="/users/queues/:id" component={LegacyQueuePage} />
        <Route path="/users/groups/:id" component={() => <QueuePage group />} />
        <Route path="/connectors" component={ConnectorsPage} />
        <Route path="/connectors/:provider" component={ConnectorsPage} />
        <Route path="/catalog" component={CatalogPage} />
        <Route path="/workflows" component={WorkflowsPage} />
        <Route path="/workflows/new" component={WorkflowBuilderPage} />
        <Route path="/workflows/:id/edit" component={WorkflowBuilderPage} />
        <Route path="/chat" component={ChatPage} />
        <Route path="/chat/:id" component={ChatPage} />
        <Route path="/approvals" component={ApprovalsPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/reports/audit/:id" component={AuditRecordPage} />
        <Route path="/knowledge" component={KnowledgePage} />
        <Route path="/knowledge/bases/:id" component={KnowledgeBasePage} />
        <Route path="/knowledge/topics/new" component={CreateTopicPage} />
        <Route path="/knowledge/source/:id" component={SourceDocumentPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/records/:type/:id/edit" component={EditRecordPage} />
        <Route path="/integrations" component={ConnectionsPage} />
        <Route path="/integrations/:provider/:id/edit" component={EditConnectionPage} />
        <Route path="/integrations/:provider" component={ConnectionPage} />
        <Route path="/profile" component={AccountPage} />
        <Route path="/settings" component={AccountPage} />
        <Route path="/create/:type" component={CreatePage} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/help" component={HelpPage} />
        <Route path="/help/:id" component={ArticlePage} />
        <Route path="/articles/:id" component={ArticlePage} />
        <Route path="/articles/:id/edit" component={EditArticlePage} />
        <Route path="/files/:id" component={ContentPage} />
        <Route path="/images/:id" component={ContentPage} />
      </Route>
      <Route path="*404" component={NotFoundPage} />
    </Router>
  );
}
