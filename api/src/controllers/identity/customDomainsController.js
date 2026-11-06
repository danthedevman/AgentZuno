import { fail } from '../../identity/customDomains.js';
export function createCustomDomainsController(service) {
  const getDomain = async (req, res) => res.json(await service.get(req.helpdeskUser));
  const putDomain = async (req, res) => res.json(await service.save(req.helpdeskUser, req.body));
  const postDomainVerify = async (req, res) => {
    if (!req.body || Object.keys(req.body).length) fail('Unsupported verification setting.');
    res.json(await service.verify(req.helpdeskUser));
  };
  const putDomainEnabled = async (req, res) => {
    if (
      !req.body ||
      Object.keys(req.body).some((key) => key !== 'enabled') ||
      typeof req.body.enabled !== 'boolean'
    )
      fail('Choose whether to enable the portal.');
    if (req.body.enabled) return res.json(await service.verify(req.helpdeskUser, true));
    res.json(await service.disable(req.helpdeskUser));
  };
  const deleteDomain = async (req, res) => res.json(await service.remove(req.helpdeskUser));
  return { getDomain, putDomain, postDomainVerify, putDomainEnabled, deleteDomain };
}
