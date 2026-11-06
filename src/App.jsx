import SlackLinkPage from './pages/auth/SlackLinkPage.jsx';
import InstallationPage from './pages/setup/InstallationPage.jsx';
import TaskPage from './pages/workspace/requests/TaskPage.jsx';
import DatabaseSetupPage from './pages/setup/DatabaseSetupPage.jsx';
import SetupPage from './pages/workspace/SetupPage.jsx';
import AuditRecordPage from './pages/workspace/reports/AuditRecordPage.jsx';
import MyWorkPage from './pages/workspace/reports/MyWorkPage.jsx';
import WorkspaceHomePage from './pages/workspace/WorkspaceHomePage.jsx';
import LegacyQueuePage from './pages/workspace/identity/LegacyQueuePage.jsx';
import DocsPage from './pages/public/DocsPage.jsx';
import InvitePage from './pages/auth/InvitePage.jsx';
import LegacyRequestsPage from './pages/workspace/requests/LegacyRequestsPage.jsx';
import ApprovalsPage from './pages/workspace/requests/ApprovalsPage.jsx';
import ArticlePreviewPage from './pages/public/ArticlePreviewPage.jsx';
import QueuePage from './pages/workspace/identity/QueuePage.jsx';
import ReportsPage from './pages/workspace/reports/ReportsPage.jsx';
import KnowledgeBasePage from './pages/workspace/knowledge/KnowledgeBasePage.jsx';
import DataRecordPage from './pages/workspace/data/DataRecordPage.jsx';
import DataPage from './pages/workspace/data/DataPage.jsx';
import WorkflowBuilderPage from './pages/workspace/workflows/WorkflowBuilderPage.jsx';
import RegisterPage from './pages/auth/RegisterPage.jsx';
import RequestsPage from './pages/workspace/requests/RequestsPage.jsx';
import RequestRedirectPage from './pages/workspace/requests/RequestRedirectPage.jsx';
import ChatRedirectPage from './pages/workspace/requests/ChatRedirectPage.jsx';
import UsersPage from './pages/workspace/identity/UsersPage.jsx';
import UserRecordPage from './pages/workspace/identity/UserRecordPage.jsx';
import SlackUsersPage from './pages/workspace/connectors/SlackUsersPage.jsx';
import ConnectorsPage from './pages/workspace/connectors/ConnectorsPage.jsx';
import CatalogPage from './pages/workspace/requests/CatalogPage.jsx';
import WorkflowsPage from './pages/workspace/workflows/WorkflowsPage.jsx';
import EditConnectionPage from './pages/workspace/connectors/EditConnectionPage.jsx';
import EditRecordPage from './pages/workspace/data/EditRecordPage.jsx';
import TopicPage from './pages/workspace/knowledge/TopicPage.jsx';
import CreateTopicPage from './pages/workspace/knowledge/CreateTopicPage.jsx';
import UserAccessPage from './pages/workspace/requests/UserAccessPage.jsx';
import ChatPage from './pages/workspace/requests/ChatPage.jsx';
import ArticleReadPage from './pages/workspace/knowledge/ArticleReadPage.jsx';
import { Router, Route } from '@solidjs/router';
import AppLayout from './layouts/AppLayout.jsx';
import WorkspaceLayout from './layouts/WorkspaceLayout.jsx';
import HomePage from './pages/public/HomePage.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import DashboardPage from './pages/workspace/DashboardPage.jsx';
import KnowledgePage from './pages/workspace/knowledge/KnowledgePage.jsx';
import ArticlePage from './pages/workspace/knowledge/ArticlePage.jsx';
import ContentPage from './pages/workspace/ContentPage.jsx';
import HelpPage from './pages/workspace/HelpPage.jsx';
import SearchPage from './pages/workspace/SearchPage.jsx';
import ConnectionPage from './pages/workspace/connectors/ConnectionPage.jsx';
import ConnectionsPage from './pages/workspace/connectors/ConnectionsPage.jsx';
import TaskListPage from './pages/workspace/requests/TaskListPage.jsx';
import AccountPage from './pages/workspace/identity/AccountPage.jsx';
import SourceDocumentPage from './pages/workspace/knowledge/SourceDocumentPage.jsx';
import EditArticlePage from './pages/workspace/knowledge/EditArticlePage.jsx';
import CreatePage from './pages/workspace/CreatePage.jsx';

export default function App() {
  return (
    <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')} root={AppLayout}>
      <Route
        path="/"
        component={import.meta.env.VITE_STATIC_SITE === 'true' ? HomePage : InstallationPage}
      />
      <Route path="/docs" component={DocsPage} />
      <Route path="/docs/:guide" component={DocsPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/preview/:workspaceId/proposals/:id" component={ArticlePreviewPage} />
      <Route path="/slack/link" component={SlackLinkPage} />
      <Route path="/invite" component={InvitePage} />
      <Route path="/setup/database" component={DatabaseSetupPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path={['/workspace', '/workspace/:workspaceId']} component={WorkspaceLayout}>
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
        <Route path="/connectors/slack/users" component={SlackUsersPage} />
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
        <Route path="/knowledge/topics/:topicId" component={TopicPage} />
        <Route path="/knowledge/source/:id" component={SourceDocumentPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/records/:type/:id/edit" component={EditRecordPage} />
        <Route path="/integrations" component={ConnectionsPage} />
        <Route path="/integrations/:provider/:id/edit" component={EditConnectionPage} />
        <Route path="/integrations/:provider" component={ConnectionPage} />
        <Route path="/profile" component={AccountPage} />
        <Route path="/settings" component={AccountPage} />
        <Route path="/create/:type" component={CreatePage} />
        <Route path="/access" component={UserAccessPage} />
        <Route path="/access/:id" component={UserAccessPage} />
        <Route path="/tasks" component={TaskListPage} />
        <Route path="/tasks/:taskId" component={TaskPage} />
        <Route path="/help" component={HelpPage} />
        <Route path="/help/:id" component={ArticlePage} />
        <Route path="/articles/:id" component={ArticlePage} />
        <Route path="/articles/:id/read" component={ArticleReadPage} />
        <Route path="/articles/:id/edit" component={EditArticlePage} />
        <Route path="/files/:id" component={ContentPage} />
        <Route path="/images/:id" component={ContentPage} />
      </Route>
      <Route path="*404" component={NotFoundPage} />
    </Router>
  );
}
