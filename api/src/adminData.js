import { workspaceGroups } from './groups.js';
import { userReferenceOptions } from './userReferences.js';
import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { helpdeskScope, requireRole, deny } from './helpdeskRoles.js';
import { referenceTypes } from './workforceProfiles.js';
import { listResponse } from './listQuery.js';
export const dataDesignerInstructions = `You are the Admin agent designing reference and mapping tables. Ask concise clarifying questions. When requirements are clear, return the complete proposed table as fenced json: {"name":"Departments","description":"Purpose","fields":[{"id":"name","label":"Name","type":"text","required":true}]}. Maximum 20 fields; field IDs are unique lowercase letters/digits/hyphens, starting with a letter, max 40. Types: text, number, boolean, date, email, reference. A reference field must include referenceTable, either "users" or an existing table ID supplied by the server. Other fields cannot include referenceTable. Name max 80, description max 1000, labels max 80. Never invent table IDs, claim changes have been saved, execute code, create records, or grant permissions. Changes require explicit Admin review and Save. Preserve manually edited definitions supplied privately.`;
const text = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    deny('Invalid data text.', 400);
  return value.trim();
};
export function defineDataTable(input) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== 'object' ||
    Object.keys(input).some((key) => !['name', 'description', 'fields'].includes(key)) ||
    !Array.isArray(input.fields) ||
    !input.fields.length ||
    input.fields.length > 20
  )
    deny('Provide a table name and 1–20 fields.', 400);
  const fields = input.fields.map((field) => {
    if (
      !field ||
      Object.keys(field).some(
        (key) => !['id', 'label', 'type', 'required', 'referenceTable'].includes(key),
      ) ||
      typeof field.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(field.id) ||
      ['constructor', 'prototype'].includes(field.id) ||
      !['text', 'number', 'boolean', 'date', 'email', 'reference'].includes(field.type) ||
      typeof field.required !== 'boolean'
    )
      deny('Invalid data field.', 400);
    if (
      field.type === 'reference'
        ? typeof field.referenceTable !== 'string' || field.referenceTable.length > 80
        : field.referenceTable !== undefined
    )
      deny('Choose a reference table.', 400);
    return {
      id: field.id,
      label: text(field.label, 80),
      type: field.type,
      required: field.required,
      ...(field.type === 'reference' ? { referenceTable: field.referenceTable } : {}),
    };
  });
  if (new Set(fields.map((field) => field.id)).size !== fields.length)
    deny('Field IDs must be unique.', 400);
  return {
    name: text(input.name, 80),
    description: input.description ? text(input.description, 1000) : '',
    fields,
  };
}
const names = {
  department: 'Departments',
  location: 'Locations',
  organization: 'Organizations',
  division: 'Divisions',
  costCenter: 'Cost Centers',
  asset: 'Assets',
  application: 'Applications',
  vendor: 'Vendors',
  contract: 'Contracts',
  service: 'Services',
  license: 'Software Licenses',
  'asset-model': 'Asset Models',
  'catalog-category': 'Catalog Categories',
  user: 'Users',
  queue: 'Queues',
  group: 'Groups',
  workflow: 'Workflows',
};
const optional = (id, label, type = 'text', referenceTable) => ({
  id,
  label,
  type,
  required: false,
  ...(referenceTable ? { referenceTable } : {}),
});
const serviceDeskTypes = [
  'asset',
  'application',
  'vendor',
  'contract',
  'service',
  'license',
  'asset-model',
  'catalog-category',
  'user',
  'queue',
  'group',
  'workflow',
];
const allBuiltinTypes = [...referenceTypes, ...serviceDeskTypes];
const builtinFields = {
  'catalog-category': [optional('code', 'Code')],
  user: [optional('email', 'Email', 'email'), optional('role', 'Role')],
  queue: [optional('routing-instructions', 'Routing Instructions')],
  group: [
    optional('active', 'Active', 'boolean'),
    optional('assignmentEnabled', 'Assignment Group', 'boolean'),
    optional('approvalEnabled', 'Approval Group', 'boolean'),
  ],
  workflow: [optional('published', 'Published', 'boolean')],
  asset: [
    optional('asset-tag', 'Asset Tag'),
    optional('serial-number', 'Serial Number'),
    optional('model', 'Model', 'reference', 'ref-asset-model'),
    optional('status', 'Status'),
    optional('assigned-to', 'Assigned To', 'reference', 'users'),
    optional('managed-by', 'Managed By', 'reference', 'users'),
    optional('location', 'Location', 'reference', 'ref-location'),
    optional('department', 'Department', 'reference', 'ref-department'),
    optional('cost-center', 'Cost Center', 'reference', 'ref-cost-center'),
    optional('vendor', 'Vendor', 'reference', 'ref-vendor'),
    optional('contract', 'Contract', 'reference', 'ref-contract'),
    optional('purchase-date', 'Purchase Date', 'date'),
    optional('warranty-end', 'Warranty End', 'date'),
    optional('purchase-cost', 'Purchase Cost', 'number'),
    optional('currency', 'Currency'),
    optional('hostname', 'Hostname'),
    optional('retirement-date', 'Retirement Date', 'date'),
  ],
  'asset-model': [
    optional('manufacturer', 'Manufacturer'),
    optional('model-number', 'Model Number'),
    optional('category', 'Category'),
    optional('standard', 'Standard Offering', 'boolean'),
    optional('vendor', 'Vendor', 'reference', 'ref-vendor'),
    optional('support-life', 'Support End Date', 'date'),
  ],
  application: [
    optional('owner', 'Application Owner', 'reference', 'users'),
    optional('technical-owner', 'Technical Owner', 'reference', 'users'),
    optional('vendor', 'Vendor', 'reference', 'ref-vendor'),
    optional('service', 'Service', 'reference', 'ref-service'),
    optional('status', 'Status'),
    optional('criticality', 'Business Criticality'),
    optional('support-queue', 'Support Queue'),
    optional('sso-enabled', 'SSO Enabled', 'boolean'),
    optional('data-classification', 'Data Classification'),
    optional('renewal-date', 'Renewal Date', 'date'),
  ],
  vendor: [
    optional('contact-name', 'Contact Name'),
    optional('contact-email', 'Contact Email', 'email'),
    optional('phone', 'Phone'),
    optional('account-number', 'Account Number'),
    optional('relationship-owner', 'Relationship Owner', 'reference', 'users'),
    optional('status', 'Status'),
    optional('support-hours', 'Support Hours'),
  ],
  contract: [
    optional('contract-number', 'Contract Number'),
    optional('vendor', 'Vendor', 'reference', 'ref-vendor'),
    optional('owner', 'Contract Owner', 'reference', 'users'),
    optional('status', 'Status'),
    optional('start-date', 'Start Date', 'date'),
    optional('end-date', 'End Date', 'date'),
    optional('renewal-date', 'Renewal Date', 'date'),
    optional('notice-days', 'Renewal Notice Days', 'number'),
    optional('annual-cost', 'Annual Cost', 'number'),
    optional('currency', 'Currency'),
    optional('cost-center', 'Cost Center', 'reference', 'ref-cost-center'),
  ],
  service: [
    optional('owner', 'Service Owner', 'reference', 'users'),
    optional('technical-owner', 'Technical Owner', 'reference', 'users'),
    optional('status', 'Status'),
    optional('criticality', 'Business Criticality'),
    optional('support-queue', 'Support Queue'),
    optional('support-hours', 'Support Hours'),
    optional('target-response-minutes', 'Target Response Minutes', 'number'),
    optional('target-resolution-hours', 'Target Resolution Hours', 'number'),
    optional('department', 'Department', 'reference', 'ref-department'),
  ],
  license: [
    optional('application', 'Application', 'reference', 'ref-application'),
    optional('contract', 'Contract', 'reference', 'ref-contract'),
    optional('vendor', 'Vendor', 'reference', 'ref-vendor'),
    optional('owner', 'License Owner', 'reference', 'users'),
    optional('status', 'Status'),
    optional('purchased-seats', 'Purchased Seats', 'number'),
    optional('assigned-seats', 'Assigned Seats', 'number'),
    optional('renewal-date', 'Renewal Date', 'date'),
    optional('annual-cost', 'Annual Cost', 'number'),
    optional('currency', 'Currency'),
  ],
  department: [
    optional('code', 'Department Code'),
    optional('manager', 'Department Head', 'reference', 'users'),
    optional('organization', 'Organization', 'reference', 'ref-organization'),
    optional('parent-department', 'Parent Department', 'reference', 'ref-department'),
    optional('cost-center', 'Cost Center', 'reference', 'ref-cost-center'),
    optional('location', 'Location', 'reference', 'ref-location'),
    optional('email', 'Contact Email', 'email'),
  ],
  location: [
    optional('code', 'Location Code'),
    optional('address', 'Street Address'),
    optional('city', 'City'),
    optional('region', 'State / Region'),
    optional('postal-code', 'Postal Code'),
    optional('country', 'Country'),
    optional('timezone', 'Time Zone'),
    optional('contact', 'Site Contact', 'reference', 'users'),
    optional('organization', 'Organization', 'reference', 'ref-organization'),
  ],
  organization: [
    optional('code', 'Organization Code'),
    optional('legal-name', 'Legal Name'),
    optional('domain', 'Domain'),
    optional('email', 'Contact Email', 'email'),
    optional('phone', 'Phone'),
    optional('owner', 'Organization Owner', 'reference', 'users'),
    optional('parent-organization', 'Parent Organization', 'reference', 'ref-organization'),
  ],
  division: [
    optional('code', 'Division Code'),
    optional('manager', 'Division Head', 'reference', 'users'),
    optional('organization', 'Organization', 'reference', 'ref-organization'),
    optional('parent-division', 'Parent Division', 'reference', 'ref-division'),
    optional('cost-center', 'Cost Center', 'reference', 'ref-cost-center'),
    optional('email', 'Contact Email', 'email'),
  ],
  costCenter: [
    optional('code', 'Cost Center Code'),
    optional('owner', 'Budget Owner', 'reference', 'users'),
    optional('organization', 'Organization', 'reference', 'ref-organization'),
    optional('department', 'Department', 'reference', 'ref-department'),
    optional('budget', 'Annual Budget', 'number'),
    optional('currency', 'Currency'),
    optional('fiscal-year', 'Fiscal Year', 'number'),
  ],
};
const builtinType = (id) =>
  allBuiltinTypes.find((type) => `ref-${type === 'costCenter' ? 'cost-center' : type}` === id);
const schemaId = (user, id) => JSON.stringify([helpdeskScope(user).ownerId, user.workspaceId, id]);
const builtin = (type) => ({
  id: `ref-${type === 'costCenter' ? 'cost-center' : type}`,
  name: names[type],
  description: serviceDeskTypes.includes(type)
    ? 'IT service desk records'
    : 'Shared workforce references',
  version: 1,
  system: true,
  protectedFields: ['name', 'description', ...builtinFields[type].map((field) => field.id)],
  ...(['user', 'queue', 'group', 'workflow'].includes(type)
    ? {
        sourceManaged: true,
        readOnlyFields: ['name', 'description', ...builtinFields[type].map((field) => field.id)],
      }
    : {}),
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'text', required: false },
    ...builtinFields[type],
  ],
});
const safe = ({ _id, ownerId, workspaceId, ...record }) => ({ id: String(_id), ...record });
export function createAdminData(store) {
  async function table(user, id) {
    requireRole(user, ['admin']);
    const type = builtinType(id);
    if (type) {
      const saved = await store
        .collection('adminDataTables')
        .findOne({ ...helpdeskScope(user), _id: schemaId(user, id), system: true });
      const base = builtin(type);
      return saved
        ? {
            ...base,
            ...safe(saved),
            id,
            protectedFields: base.protectedFields,
            fields: [
              ...base.fields.map((field) => ({
                ...field,
                label: saved.fields.find((item) => item.id === field.id)?.label || field.label,
              })),
              ...saved.fields.filter((field) => !base.protectedFields.includes(field.id)),
            ],
          }
        : base;
    }
    if (!ObjectId.isValid(id)) deny('Table not found.', 404);
    const record = await store
      .collection('adminDataTables')
      .findOne({ ...helpdeskScope(user), _id: new ObjectId(id), archived: { $ne: true } });
    if (!record) deny('Table not found.', 404);
    return safe(record);
  }
  async function tables(user) {
    requireRole(user, ['admin']);
    return [
      ...(await Promise.all(
        allBuiltinTypes
          .filter((type) => type !== 'queue')
          .map((type) => table(user, builtin(type).id)),
      )),
      ...(
        await store
          .collection('adminDataTables')
          .find({ ...helpdeskScope(user), archived: { $ne: true }, system: { $ne: true } })
          .limit(100)
          .toArray()
      ).map(safe),
    ];
  }
  async function validateReferences(user, definition) {
    for (const field of definition.fields.filter((field) => field.type === 'reference'))
      if (field.referenceTable !== 'users') await table(user, field.referenceTable);
  }
  async function saveTable(user, id, input) {
    requireRole(user, ['admin']);
    if (
      !input ||
      Object.keys(input).some(
        (key) =>
          !['definition', 'version', 'confirmFieldRemoval', 'confirmedRemovedFieldIds'].includes(
            key,
          ),
      )
    )
      deny('Invalid table fields.', 400);
    const definition = defineDataTable(input.definition);
    await validateReferences(user, definition);
    if (!id) {
      if (
        (await store
          .collection('adminDataTables')
          .countDocuments({ ...helpdeskScope(user), system: { $ne: true } })) >= 100
      )
        deny('Table limit reached.', 422);
      const record = {
        ...helpdeskScope(user),
        ...definition,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      record._id = (await store.collection('adminDataTables').insertOne(record)).insertedId;
      return safe(record);
    }
    const previous = await table(user, id);
    const removedFields = previous.fields.filter(
      (field) => !definition.fields.some((item) => item.id === field.id),
    );
    if (
      previous.system &&
      removedFields.some((field) => previous.protectedFields.includes(field.id))
    )
      deny('Built-in fields cannot be removed.', 409);
    if (
      removedFields.some(
        (field) =>
          !Array.isArray(input.confirmedRemovedFieldIds) ||
          !input.confirmedRemovedFieldIds.includes(field.id),
      )
    )
      throw Object.assign(new Error('Confirm field removal before saving.'), {
        publicMessage: 'Confirm field removal before saving.',
        status: 409,
        removedFields: removedFields.map(({ id, label }) => ({ id, label })),
      });
    if (
      previous.system &&
      previous.fields
        .filter((field) => previous.protectedFields.includes(field.id))
        .some(
          (field) =>
            !definition.fields.some(
              (next) =>
                next.id === field.id &&
                next.type === field.type &&
                next.referenceTable === field.referenceTable &&
                next.required === field.required,
            ),
        )
    )
      deny('Keep built-in fields and their original types, references, and requirements.', 409);
    if (previous.version !== input.version) deny('Table changed. Reload before saving.', 409);
    const existing = await records(user, id);
    for (const field of previous.fields) {
      const next = definition.fields.find((item) => item.id === field.id);
      const changed =
        !next || next.type !== field.type || next.referenceTable !== field.referenceTable;
      if (
        changed &&
        existing.some(
          (record) =>
            record.values[field.id] !== undefined &&
            record.values[field.id] !== '' &&
            record.values[field.id] !== null,
        )
      )
        deny(
          'This field contains saved values. Keep its type and reference table, or clear its values before removing or changing it.',
          409,
        );
    }
    for (const field of definition.fields) {
      if (
        field.required &&
        existing.some(
          (record) =>
            record.values[field.id] === undefined ||
            record.values[field.id] === '' ||
            record.values[field.id] === null,
        )
      )
        deny('Fill this field on existing records before making it required.', 409);
    }
    if (previous.system) {
      const filter = { ...helpdeskScope(user), _id: schemaId(user, id), system: true };
      const saved = await store.collection('adminDataTables').findOne(filter);
      if (!saved) {
        try {
          await store.collection('adminDataTables').insertOne({
            ...filter,
            ...definition,
            version: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } catch (error) {
          if (error.code === 11000) deny('Table changed. Reload before saving.', 409);
          throw error;
        }
      } else {
        const result = await store
          .collection('adminDataTables')
          .updateOne(
            { ...filter, version: input.version },
            { $set: { ...definition, updatedAt: new Date() }, $inc: { version: 1 } },
          );
        if (!result.matchedCount) deny('Table changed. Reload before saving.', 409);
      }
      return table(user, id);
    }
    const result = await store
      .collection('adminDataTables')
      .findOneAndUpdate(
        { ...helpdeskScope(user), _id: new ObjectId(id), version: input.version },
        { $set: { ...definition, updatedAt: new Date() }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      );
    if (!result) deny('Table changed. Reload before saving.', 409);
    return safe(result);
  }
  async function records(user, tableId) {
    const definition = await table(user, tableId);
    if (definition.sourceManaged) {
      const type = tableId.slice(4);
      let source;
      if (type === 'user') {
        const members = await store
          .collection('helpdeskMembers')
          .find({ ...helpdeskScope(user), active: true })
          .toArray();
        source = (await userReferenceOptions(store, user)).map((record) => ({
          id: record.value,
          name: record.name,
          email: record.email,
          role: members.find((member) => member.userId === record.value)?.role || '',
          sourceHref: `/workspace/users/${record.value}`,
        }));
      } else {
        if (type === 'group') await workspaceGroups(store, user);
        const collection = {
          queue: 'helpdeskQueues',
          group: 'approvalGroups',
          workflow: 'helpdeskWorkflows',
        }[type];
        source = (await store.collection(collection).find(helpdeskScope(user)).toArray()).map(
          (record) => ({
            ...record,
            id: String(record._id),
            published: !!record.enabled,
            'routing-instructions': record.routingInstructions || '',
            sourceHref:
              type === 'workflow'
                ? `/workspace/workflows/${record._id}/edit`
                : `/workspace/users/${type === 'queue' ? 'queues' : 'groups'}/${record._id}`,
          }),
        );
      }
      const custom = await store
        .collection('adminDataRecords')
        .find({ ...helpdeskScope(user), tableId })
        .toArray();
      return source.map((record) => {
        const saved = custom.find((item) => item.sourceId === record.id);
        return {
          id: record.id,
          version: saved?.version || 0,
          sourceHref: record.sourceHref,
          updatedAt: saved?.updatedAt || record.updatedAt,
          values: Object.fromEntries(
            definition.fields.map((field) => [
              field.id,
              definition.readOnlyFields.includes(field.id)
                ? (record[field.id] ?? (field.type === 'boolean' ? false : ''))
                : (saved?.values?.[field.id] ?? (field.type === 'boolean' ? false : '')),
            ]),
          ),
        };
      });
    }
    if (definition.system)
      return (
        await store
          .collection('workforceReferences')
          .find({
            ...helpdeskScope(user),
            type: tableId.slice(4) === 'cost-center' ? 'costCenter' : tableId.slice(4),
          })
          .toArray()
      ).map((record) => ({
        id: record._id,
        version: record.version || 0,
        values: Object.fromEntries(
          definition.fields.map((field) => [
            field.id,
            field.id === 'name'
              ? record.name
              : field.id === 'description'
                ? record.description || ''
                : (record.customValues?.[field.id] ?? (field.type === 'boolean' ? false : '')),
          ]),
        ),
        updatedAt: record.updatedAt || record.createdAt,
      }));
    return (
      await store
        .collection('adminDataRecords')
        .find({ ...helpdeskScope(user), tableId, archived: { $ne: true } })
        .toArray()
    ).map(safe);
  }
  async function options(user, tableId) {
    requireRole(user, ['admin']);
    if (tableId === 'users') return userReferenceOptions(store, user);
    const definition = await table(user, tableId);
    const first = definition.system ? 'name' : definition.fields[0].id;
    return (await records(user, tableId)).map((record) => ({
      value: record.id,
      label: String(record.values[first] ?? record.id),
      href: `/workspace/data/${tableId}/records/${record.id}`,
    }));
  }
  async function saveRecord(user, tableId, id, input) {
    const definition = await table(user, tableId);
    if (
      !input ||
      Object.keys(input).some((key) => !['values', 'version'].includes(key)) ||
      !input.values ||
      Array.isArray(input.values) ||
      typeof input.values !== 'object' ||
      Object.keys(input.values).some((key) => !definition.fields.some((field) => field.id === key))
    )
      deny('Invalid record fields.', 400);
    const values = {};
    for (const field of definition.fields) {
      const value = Object.hasOwn(input.values, field.id) ? input.values[field.id] : undefined;
      if (value === undefined || value === null || value === '') {
        if (field.required) deny(`${field.label} is required.`, 400);
        values[field.id] = field.type === 'boolean' ? false : '';
        continue;
      }
      if (
        field.type === 'number' &&
        (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12)
      )
        deny(`Invalid ${field.label}.`, 400);
      if (field.type === 'boolean' && typeof value !== 'boolean')
        deny(`Invalid ${field.label}.`, 400);
      if (!['number', 'boolean'].includes(field.type)) text(value, 2000);
      if (
        field.type === 'date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        deny('Invalid date.', 400);
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        deny('Invalid email.', 400);
      if (
        field.type === 'reference' &&
        !(await options(user, field.referenceTable)).some((option) => option.value === value)
      )
        deny('Reference record is unavailable.', 400);
      values[field.id] = value;
    }
    if (definition.sourceManaged) {
      const current = (await records(user, tableId)).find((record) => record.id === id);
      if (!current) deny('Create this record from its dedicated page.', 409);
      if (definition.readOnlyFields.some((key) => values[key] !== current.values[key]))
        deny('Built-in values are managed on the original record.', 409);
      if (input.version !== current.version) deny('Record changed. Reload before saving.', 409);
      const filter = {
        _id: JSON.stringify([helpdeskScope(user), tableId, id]),
        ...helpdeskScope(user),
        tableId,
        sourceId: id,
      };
      const customValues = Object.fromEntries(
        Object.entries(values).filter(([key]) => !definition.readOnlyFields.includes(key)),
      );
      if (!current.version) {
        try {
          await store
            .collection('adminDataRecords')
            .insertOne({ ...filter, values: customValues, version: 1, updatedAt: new Date() });
        } catch (error) {
          if (error.code === 11000) deny('Record changed. Reload before saving.', 409);
          throw error;
        }
      } else {
        const result = await store
          .collection('adminDataRecords')
          .updateOne(
            { ...filter, version: input.version },
            { $set: { values: customValues, updatedAt: new Date() }, $inc: { version: 1 } },
          );
        if (!result.matchedCount) deny('Record changed. Reload before saving.', 409);
      }
      return (await records(user, tableId)).find((record) => record.id === id);
    }
    if (definition.system) {
      const type = tableId.slice(4) === 'cost-center' ? 'costCenter' : tableId.slice(4);
      const { name, description, ...customValues } = values;
      if (name.length > 160) deny('Name must contain at most 160 characters.', 400);
      if (!id) {
        const scope = helpdeskScope(user);
        const referenceId = createHash('sha256')
          .update(`${scope.ownerId}:${scope.workspaceId}:${type}:${name.toLowerCase()}`)
          .digest('hex')
          .slice(0, 24);
        try {
          await store.collection('workforceReferences').insertOne({
            _id: referenceId,
            ...scope,
            type,
            name,
            description: description || '',
            customValues,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } catch (error) {
          if (error.code === 11000)
            deny('A reference with this name already exists. Edit the existing record.', 409);
          throw error;
        }
        return { id: referenceId, values, version: 1 };
      }
      if (
        typeof id !== 'string' ||
        !/^[a-f0-9]{24}$/.test(id) ||
        !Number.isInteger(input.version) ||
        input.version < 0
      )
        deny('Invalid record.', 400);
      const updated = await store.collection('workforceReferences').findOneAndUpdate(
        {
          _id: id,
          ...helpdeskScope(user),
          type,
          ...(input.version ? { version: input.version } : { version: { $exists: false } }),
        },
        {
          $set: {
            name,
            description: description || '',
            customValues,
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!updated) deny('Reference changed. Reload before saving.', 409);
      return { id, values, version: updated.version };
    }
    const filter = { ...helpdeskScope(user), tableId };
    if (!id) {
      if ((await store.collection('adminDataRecords').countDocuments(filter)) >= 10000)
        deny('Record limit reached.', 422);
      const result = await store
        .collection('adminDataRecords')
        .insertOne({ ...filter, values, version: 1, createdAt: new Date(), updatedAt: new Date() });
      return { id: result.insertedId.toHexString() };
    }
    if (!ObjectId.isValid(id) || !Number.isInteger(input.version)) deny('Invalid record.', 400);
    const updated = await store
      .collection('adminDataRecords')
      .findOneAndUpdate(
        { ...filter, _id: new ObjectId(id), version: input.version },
        { $set: { values, updatedAt: new Date() }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      );
    if (!updated) deny('Record changed. Reload before saving.', 409);
    return safe(updated);
  }
  return { table, tables, saveTable, records, options, saveRecord };
}
export function installAdminDataRoutes(app, store, chats) {
  const service = createAdminData(store);
  app.get('/api/helpdesk/data/tables', async (request, response) =>
    response.json(
      listResponse(
        request,
        await service.tables(request.helpdeskUser),
        {
          Table: 'name',
          Description: 'description',
          Fields: (item) => item.fields.length,
          Updated: (item) => (item.updatedAt ? Date.parse(item.updatedAt) : null),
        },
        { sort: 'Table' },
      ),
    ),
  );
  app.post('/api/helpdesk/data/tables', async (request, response) =>
    response.status(201).json(await service.saveTable(request.helpdeskUser, null, request.body)),
  );
  app.get('/api/helpdesk/data/tables/:id', async (request, response) =>
    response.json(await service.table(request.helpdeskUser, request.params.id)),
  );
  app.put('/api/helpdesk/data/tables/:id', async (request, response) =>
    response.json(await service.saveTable(request.helpdeskUser, request.params.id, request.body)),
  );
  app.get('/api/helpdesk/data/tables/:id/options', async (request, response) =>
    response.json(await service.options(request.helpdeskUser, request.params.id)),
  );
  app.get('/api/helpdesk/data/tables/:id/records', async (request, response) => {
    const table = await service.table(request.helpdeskUser, request.params.id);
    const records = await service.records(request.helpdeskUser, request.params.id);
    const lookups = new Map();
    for (const field of table.fields.filter((field) => field.type === 'reference'))
      lookups.set(field.id, await service.options(request.helpdeskUser, field.referenceTable));
    const rows = records.map((record) => ({
      ...record,
      labels: Object.fromEntries(
        [...lookups].map(([key, options]) => [
          key,
          options.find((item) => item.value === record.values[key])?.label || '—',
        ]),
      ),
    }));
    response.json(
      listResponse(
        request,
        rows,
        Object.fromEntries([
          ...table.fields.map((field) => [
            field.id,
            (row) => (field.type === 'reference' ? row.labels[field.id] : row.values[field.id]),
          ]),
          ['Updated', (row) => (row.updatedAt ? Date.parse(row.updatedAt) : null)],
        ]),
      ),
    );
  });
  app.get('/api/helpdesk/data/tables/:id/records/:recordId', async (request, response) => {
    const records = await service.records(request.helpdeskUser, request.params.id);
    const record = records.find((item) => String(item.id) === request.params.recordId);
    if (!record) deny('Record not found.', 404);
    response.json(record);
  });
  app.get(
    '/api/helpdesk/data/tables/ref-catalog-category/records/:recordId/workflows',
    async (request, response) => {
      const user = request.helpdeskUser;
      const records = await service.records(user, 'ref-catalog-category');
      if (!records.some((record) => String(record.id) === request.params.recordId))
        deny('Category not found.', 404);
      const workflows = await store
        .collection('helpdeskWorkflows')
        .find({
          ...helpdeskScope(user),
          $or: [
            { 'definition.settings.category': request.params.recordId },
            { 'publishedConfig.definition.settings.category': request.params.recordId },
          ],
        })
        .toArray();
      response.json(
        listResponse(
          request,
          workflows.map((record) => ({
            id: String(record._id),
            name: record.name,
            status: record.enabled ? 'Published' : 'Draft',
            updatedAt: record.updatedAt,
          })),
          { Workflow: 'name', Status: 'status', Updated: (item) => Date.parse(item.updatedAt) },
        ),
      );
    },
  );
  app.delete('/api/helpdesk/data/tables/:id', async (request, response) => {
    const table = await service.table(request.helpdeskUser, request.params.id);
    if (table.system) deny('Built-in data tables cannot be deleted.', 409);
    deny('Table deletion is not supported.', 405);
  });
  app.post('/api/helpdesk/data/tables/:id/records', async (request, response) =>
    response
      .status(201)
      .json(await service.saveRecord(request.helpdeskUser, request.params.id, null, request.body)),
  );
  app.put('/api/helpdesk/data/tables/:id/records/:recordId', async (request, response) =>
    response.json(
      await service.saveRecord(
        request.helpdeskUser,
        request.params.id,
        request.params.recordId,
        request.body,
      ),
    ),
  );
  async function association(user, id) {
    requireRole(user, ['admin']);
    const value = await store
      .collection('adminDataConversations')
      .findOne({ ...helpdeskScope(user), actorId: user.id, chatId: id });
    if (!value) deny('Data conversation not found.', 404);
    return value;
  }
  app.post('/api/helpdesk/data/conversations', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const input = request.body;
    if (
      !input ||
      Object.keys(input).some((key) => !['requestId', 'text', 'definition'].includes(key))
    )
      deny('Invalid conversation fields.', 400);
    const draft = input.definition ? defineDataTable(input.definition) : null;
    const chat = await chats.create(
      user,
      { requestId: input.requestId, text: text(input.text, 4000) },
      {
        providerOwnerId: user.helpdeskOwnerId || user.id,
        assistantType: 'admin',
        helpdeskPurpose: 'workflow',
        dataDesigner: true,
        ...(draft ? { dataDraft: draft } : {}),
      },
    );
    await store.collection('adminDataConversations').updateOne(
      { ...helpdeskScope(user), actorId: user.id, chatId: chat.id },
      {
        $setOnInsert: {
          ...helpdeskScope(user),
          actorId: user.id,
          chatId: chat.id,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    response.status(202).json(chat);
  });
  app.post('/api/helpdesk/data/conversations/:id/messages', async (request, response) => {
    const user = request.helpdeskUser;
    await association(user, request.params.id);
    const input = request.body;
    if (!input || Object.keys(input).some((key) => !['text', 'retry', 'definition'].includes(key)))
      deny('Invalid conversation fields.', 400);
    response
      .status(202)
      .json(
        await chats.send(
          user,
          request.params.id,
          input.retry === true ? { retry: true } : { text: text(input.text, 4000) },
          input.definition ? { dataDraft: defineDataTable(input.definition) } : {},
        ),
      );
  });
  app.get('/api/helpdesk/data/conversations/:id', async (request, response) => {
    const user = request.helpdeskUser;
    const previous = await association(user, request.params.id);
    const chat = await chats.get(user, request.params.id);
    const latest = [...chat.messages].reverse().find((message) => message.role === 'assistant');
    let definition = previous.definition || null;
    if (latest?.status === 'complete') {
      try {
        definition = defineDataTable(
          JSON.parse(latest.text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || latest.text),
        );
        await store
          .collection('adminDataConversations')
          .updateOne({ _id: previous._id }, { $set: { definition, updatedAt: new Date() } });
      } catch {
        /* Clarifying replies may not contain a complete schema. */
      }
    }
    response.json({
      id: request.params.id,
      status: chat.status,
      messages: chat.messages,
      definition,
    });
  });
}
