# ServiceNow knowledge adapter

This adapter requires an administrator-installed Scripted REST API. It imports published knowledge articles only, not tickets or incidents. Permission checks run as the authenticated ServiceNow user on every article read.

1. Review and install `AgentZunoKnowledge.js` as a Global, non-client-callable Script Include. Its `GlideRecordSecure`, field checks, and `KBKnowledge().canRead(record)` call are all required. If KBKnowledge is unavailable or errors, the resource must fail; never remove that check or substitute an administrator identity.
2. Create a Scripted REST API with ID `knowledge` in your application’s namespace, such as `x_company_agentzuno`. Require authentication on the service and all resources. Add GET `/me`, GET `/articles`, and GET `/articles/{id}`, and GET `/knowledge-bases` using the corresponding scripts. Restrict execute access to your intended OAuth users and configure permitted cross-scope calls as necessary.
3. Connect the instance subdomain and exact namespace in AgentZuno with a delegated user OAuth token. ServiceNow client-credentials/shared-administrator tokens are unsuitable for per-user access. Basic username/password is available only for an explicitly managed private copy.
4. Test with a restricted non-admin user. Verify an allowed article is readable and denied articles, field ACLs, KB user criteria, article criteria, revocation, retirement and script-based criteria are enforced. AgentZuno checks the bridge identity/permission marker before connecting, rechecks its identity before sync/read, and re-reads source-enforced articles before returning content.

The scripts must be validated in your ServiceNow release and tenant; a real tenant has not been available for live verification here. `KBKnowledge` is a ServiceNow script include whose availability and behavior can depend on installed Knowledge Management components and customization. Permission semantics follow the configured instance, including its administrator/contributor behavior. This is a deployment-assisted adapter, not a claim that arbitrary ServiceNow tables expose effective knowledge permissions.

References: [Knowledge Management API](https://www.servicenow.com/docs/r/api-reference/rest-apis/knowledge-api.html), [ServiceNow discussion of KBKnowledge permission evaluation](https://www.servicenow.com/community/developer-forum/determining-if-a-user-can-read-an-article/td-p/2478808).

Full deployment, local vector storage, agent access, and verification instructions: [ServiceNow setup](../../docs/servicenow-setup.md).
