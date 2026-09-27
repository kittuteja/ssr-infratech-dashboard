import { sqliteTable, text, integer, index, uniqueIndex, check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const materials=sqliteTable('materials',{
 id:text('id').primaryKey(), name:text('name').notNull(), category:text('category').notNull(), brand:text('brand').notNull(), supplier:text('supplier').notNull().default(''), specification:text('specification').notNull().default(''), project:text('project').notNull(), unit:text('unit').notNull(), quantity100:integer('quantity100').notNull(), minimum100:integer('minimum100').notNull(), price100:integer('price100').notNull(), version:integer('version').notNull().default(1), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(), createdBy:text('created_by').notNull(), updatedBy:text('updated_by').notNull()
},t=>[check('material_nonnegative',sql`${t.quantity100} >= 0 AND ${t.minimum100} > 0 AND ${t.price100} >= 0`)]);
export const movements=sqliteTable('movements',{
 id:text('id').primaryKey(), materialId:text('material_id').notNull().references(()=>materials.id), type:text('type').notNull(), quantity100:integer('quantity100').notNull(), balance100:integer('balance100').notNull(), note:text('note').notNull(), party:text('party').notNull().default(''), batch:text('batch').notNull().default(''), occurredAt:text('occurred_at').notNull(), recordedAt:text('recorded_at').notNull(), actorId:text('actor_id').notNull(), actorName:text('actor_name').notNull()
},t=>[index('idx_movements_material_recorded').on(t.materialId,t.recordedAt),check('movement_positive',sql`${t.quantity100} > 0`),check('movement_type',sql`${t.type} IN ('received','issued')`)]);
export const audit=sqliteTable('audit',{
 id:text('id').primaryKey(), materialId:text('material_id').notNull().references(()=>materials.id), action:text('action').notNull(), note:text('note').notNull(), beforeJson:text('before_json'), afterJson:text('after_json'), recordedAt:text('recorded_at').notNull(), actorId:text('actor_id').notNull(), actorName:text('actor_name').notNull()
},t=>[index('idx_audit_material_recorded').on(t.materialId,t.recordedAt)]);
export const requests=sqliteTable('requests',{
 id:text('id').primaryKey(), actorId:text('actor_id').notNull(), fingerprint:text('fingerprint').notNull(), responseJson:text('response_json').notNull(), createdAt:text('created_at').notNull()
});

export const users=sqliteTable('users',{
 id:text('id').primaryKey(), username:text('username').notNull().unique(),
 name:text('name').notNull(), role:text('role').notNull(), active:integer('active').notNull().default(1),
 passwordHash:text('password_hash').notNull(), mustChange:integer('must_change').notNull().default(1),
 passwordExpires:integer('password_expires'), authVersion:integer('auth_version').notNull().default(1),
 createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(), lastLogin:text('last_login')
},t=>[check('valid_user_role',sql`${t.role} IN ('admin','staff')`),check('valid_user_active',sql`${t.active} IN (0,1)`)]);
export const sessions=sqliteTable('sessions',{
 tokenHash:text('token_hash').primaryKey(), userId:text('user_id').notNull().references(()=>users.id),
 csrf:text('csrf').notNull(), authVersion:integer('auth_version').notNull(), expiresAt:integer('expires_at').notNull()
},t=>[index('idx_sessions_user').on(t.userId),index('idx_sessions_expiry').on(t.expiresAt)]);
export const authLimits=sqliteTable('auth_limits',{
 key:text('key').primaryKey(), count:integer('count').notNull(), resetAt:integer('reset_at').notNull()
},t=>[index('idx_auth_limits_reset').on(t.resetAt)]);
export const accountAudit=sqliteTable('account_audit',{
 id:text('id').primaryKey(), actorId:text('actor_id').notNull(), userId:text('user_id').notNull(),
 action:text('action').notNull(), recordedAt:text('recorded_at').notNull()
},t=>[index('idx_account_audit_time').on(t.recordedAt)]);

// People & Payments is additive; existing inventory and authentication are unchanged.
const attribution = () => ({
 createdAt: text('created_at').notNull(), createdBy: text('created_by').notNull().references(()=>users.id),
 updatedAt: text('updated_at').notNull(), updatedBy: text('updated_by').notNull().references(()=>users.id),
 version: integer('version').notNull().default(1)
});
export const financePeople = sqliteTable('pp_people', {
 id: text('id').primaryKey(), name: text('name').notNull(), nameKey: text('name_key').notNull(),
 code: text('code').notNull().default(''), codeKey: text('code_key'),
 email: text('email').notNull().default(''), phone: text('phone').notNull().default(''),
 notes: text('notes').notNull().default(''), rolesJson: text('roles_json').notNull(), projectsJson: text('projects_json').notNull(),
 active: integer('active').notNull().default(1), ...attribution()
}, t => [uniqueIndex('pp_person_code').on(t.codeKey), index('pp_person_name').on(t.nameKey),
 check('pp_person_active', sql`${t.active} IN (0,1)`), check('pp_person_lists', sql`json_valid(${t.rolesJson}) AND json_valid(${t.projectsJson})`)]);

export const financePayments = sqliteTable('pp_payments', {
 id: text('id').primaryKey(), transactionDate: text('transaction_date').notNull(), personId: text('person_id').notNull().references(()=>financePeople.id),
 project: text('project').notNull(), direction: text('direction').notNull(), category: text('category').notNull(),
 amountPaise: integer('amount_paise').notNull(), mode: text('mode').notNull(), status: text('status').notNull(),
 reference: text('reference').notNull().default(''), referenceKey: text('reference_key'), notes: text('notes').notNull().default(''),
 refundOf: text('refund_of').references((): AnySQLiteColumn=>financePayments.id), ...attribution()
}, t => [index('pp_payment_person_date').on(t.personId,t.transactionDate), index('pp_payment_project_date').on(t.project,t.transactionDate),
 index('pp_payment_refund').on(t.refundOf), uniqueIndex('pp_payment_reference').on(t.mode,t.direction,t.referenceKey).where(sql`${t.status} != 'void'`),
 check('pp_payment_amount',sql`typeof(${t.amountPaise}) = 'integer' AND ${t.amountPaise} BETWEEN 1 AND 1000000000000`),
 check('pp_payment_direction',sql`${t.direction} IN ('in','out')`),check('pp_payment_status',sql`${t.status} IN ('pending','completed','void')`)]);

export const financeDues = sqliteTable('pp_dues', {
 id: text('id').primaryKey(), issuedOn: text('issued_on').notNull(), dueOn: text('due_on').notNull(),
 personId: text('person_id').notNull().references(()=>financePeople.id), project: text('project').notNull(), direction: text('direction').notNull(),
 category: text('category').notNull(), amountPaise: integer('amount_paise').notNull(), status: text('status').notNull().default('open'),
 reference: text('reference').notNull().default(''), notes: text('notes').notNull().default(''), ...attribution()
}, t => [index('pp_due_person_date').on(t.personId,t.dueOn), index('pp_due_project_date').on(t.project,t.dueOn),
 check('pp_due_amount',sql`typeof(${t.amountPaise}) = 'integer' AND ${t.amountPaise} BETWEEN 1 AND 1000000000000`),
 check('pp_due_dates',sql`${t.dueOn} >= ${t.issuedOn}`), check('pp_due_direction',sql`${t.direction} IN ('in','out')`), check('pp_due_status',sql`${t.status} IN ('open','cancelled')`)]);

export const financeAllocations = sqliteTable('pp_allocations', {
 id: text('id').primaryKey(), paymentId: text('payment_id').notNull().references(()=>financePayments.id),
 dueId: text('due_id').notNull().references(()=>financeDues.id), amountPaise: integer('amount_paise').notNull(),
 appliedOn: text('applied_on').notNull(), reversedOn: text('reversed_on'),
 createdAt: text('created_at').notNull(), createdBy: text('created_by').notNull().references(()=>users.id),
 reversedAt: text('reversed_at'), reversedBy: text('reversed_by').references(()=>users.id)
}, t => [index('pp_allocation_payment').on(t.paymentId),index('pp_allocation_due').on(t.dueId),
 check('pp_allocation_amount',sql`typeof(${t.amountPaise}) = 'integer' AND ${t.amountPaise} BETWEEN 1 AND 1000000000000`),
 check('pp_allocation_dates',sql`${t.reversedOn} IS NULL OR ${t.reversedOn} >= ${t.appliedOn}`)]);

export const financeAudit = sqliteTable('pp_audit', {
 id: integer('id').primaryKey({autoIncrement:true}), entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(),
 action: text('action').notNull(), reason: text('reason').notNull(), beforeJson: text('before_json'), afterJson: text('after_json').notNull(),
 actorId: text('actor_id').notNull().references(()=>users.id), actorName: text('actor_name').notNull(), recordedAt: text('recorded_at').notNull()
}, t => [index('pp_audit_entity').on(t.entityType,t.entityId)]);

export const financeRequests = sqliteTable('pp_requests', {
 id: text('id').primaryKey(), actorId: text('actor_id').notNull().references(()=>users.id), fingerprint: text('fingerprint').notNull(),
 responseJson: text('response_json').notNull(), statusCode: integer('status_code').notNull(), createdAt: text('created_at').notNull()
});
