import { useState, useCallback } from 'react'

// ─── Schema Types ────────────────────────────────────────────────────────────

interface Condition {
  field: string
  operator: string
  value: string | number | boolean | number[]
}

interface ConditionGroup {
  logic: 'AND' | 'OR'
  conditions: Condition[]
}

interface RuleAction {
  type: string
  amount?: number | string
  percentage?: number
  unit?: string
  formula?: string
  schedule?: Record<string, number>
  computed_field?: string
}

interface Scope {
  legal_entities: string[]
  contract_types: string[]
  leave_types: string[]
}

interface ComputedField {
  id: string
  name: string
  source: string
  aggregation: string
  window: string
}

interface AccrualRule {
  id: string
  name: string
  priority: number
  scope: Scope
  condition_groups: ConditionGroup[]
  action: RuleAction
  enabled: boolean
}

interface BaseConfig {
  cycle: string
  cycle_length_months: number
  base_amount_cents: number
  unit_type: string
  frequency: string
  day_counting: string
  rounding: string
  carry_over_max_cents: number | null
  carry_over_expire_months: number | null
  negative_balance_allowed: boolean
  negative_balance_limit_cents: number | null
  balance_cap_cents: number | null
}

// ─── Field/Operator/Action Definitions ───────────────────────────────────────

interface FieldDef {
  value: string
  label: string
  category: string
  type: 'number' | 'string' | 'boolean' | 'date' | 'list'
  hint?: string
}

const CONDITION_FIELDS: FieldDef[] = [
  // Employee
  { value: 'employee.start_date.day_of_month', label: 'Start date - day of month', category: 'Employee', type: 'number' },
  { value: 'employee.tenure_years', label: 'Tenure (years)', category: 'Employee', type: 'number' },
  { value: 'employee.tenure_months', label: 'Tenure (months)', category: 'Employee', type: 'number' },
  { value: 'employee.contract_type', label: 'Contract type', category: 'Employee', type: 'string' },
  { value: 'employee.work_schedule', label: 'Work schedule type', category: 'Employee', type: 'string', hint: 'fixed, variable, irregular' },
  { value: 'employee.fte_percentage', label: 'FTE %', category: 'Employee', type: 'number' },
  { value: 'employee.department', label: 'Department', category: 'Employee', type: 'string' },
  { value: 'employee.location', label: 'Office / Location', category: 'Employee', type: 'string' },
  { value: 'employee.legal_entity', label: 'Legal entity', category: 'Employee', type: 'string' },
  { value: 'employee.country', label: 'Country', category: 'Employee', type: 'string' },
  { value: 'employee.job_title', label: 'Job title', category: 'Employee', type: 'string' },
  // Leave / Absence
  { value: 'employee.is_on_leave', label: 'Currently on leave', category: 'Absence', type: 'boolean' },
  { value: 'employee.current_leave_type', label: 'Current leave type', category: 'Absence', type: 'string', hint: 'sick_leave, parental, maternity...' },
  { value: 'employee.leave_duration_days', label: 'Current leave duration (days)', category: 'Absence', type: 'number' },
  { value: 'employee.leave_duration_weeks', label: 'Current leave duration (weeks)', category: 'Absence', type: 'number' },
  // Period
  { value: 'period.month', label: 'Current month (1-12)', category: 'Period', type: 'number' },
  { value: 'period.quarter', label: 'Current quarter (1-4)', category: 'Period', type: 'number' },
  { value: 'period.is_first_month', label: 'Is first month of employment', category: 'Period', type: 'boolean' },
  { value: 'period.is_last_month', label: 'Is termination month', category: 'Period', type: 'boolean' },
  { value: 'period.months_in_cycle', label: 'Months elapsed in cycle', category: 'Period', type: 'number' },
  // Computed (from attendance/time tracking)
  { value: 'computed.avg_hours_13w', label: 'Avg hours worked (last 13 weeks)', category: 'Computed', type: 'number', hint: 'Requires attendance data' },
  { value: 'computed.avg_hours_4w', label: 'Avg hours worked (last 4 weeks)', category: 'Computed', type: 'number', hint: 'Requires attendance data' },
  { value: 'computed.total_days_worked_month', label: 'Days worked this month', category: 'Computed', type: 'number', hint: 'Requires attendance data' },
  { value: 'computed.sick_days_ytd', label: 'Sick days taken (YTD)', category: 'Computed', type: 'number' },
]

const OPERATORS = [
  { value: '<', label: '<', description: 'less than' },
  { value: '<=', label: '<=', description: 'less than or equal' },
  { value: '==', label: '=', description: 'equals' },
  { value: '!=', label: '!=', description: 'not equals' },
  { value: '>=', label: '>=', description: 'greater than or equal' },
  { value: '>', label: '>', description: 'greater than' },
  { value: 'in', label: 'in', description: 'is one of (comma-separated)' },
  { value: 'not_in', label: 'not in', description: 'is not one of' },
  { value: 'between', label: 'between', description: 'between two values (min,max)' },
  { value: 'is_true', label: 'is true', description: '' },
  { value: 'is_false', label: 'is false', description: '' },
]

const ACTION_TYPES = [
  { value: 'accrue_full', label: 'Accrue full entitlement', hasParams: false },
  { value: 'accrue_zero', label: 'Accrue nothing (0)', hasParams: false },
  { value: 'accrue_fixed', label: 'Accrue fixed amount', hasParams: true },
  { value: 'accrue_percentage', label: 'Accrue % of normal', hasParams: true },
  { value: 'accrue_by_formula', label: 'Accrue by formula', hasParams: true },
  { value: 'accrue_by_computed_field', label: 'Accrue based on computed field', hasParams: true },
  { value: 'accrue_monthly_schedule', label: 'Accrue per monthly schedule', hasParams: true },
  { value: 'add_bonus', label: 'Add bonus days', hasParams: true },
  { value: 'set_entitlement', label: 'Set total entitlement to', hasParams: true },
  { value: 'multiply_by_fte', label: 'Multiply by FTE %', hasParams: false },
  { value: 'skip_period', label: 'Skip this period entirely', hasParams: false },
]

// ─── Presets ─────────────────────────────────────────────────────────────────

interface Preset {
  name: string
  description: string
  market: string
  computed_fields?: Omit<ComputedField, 'id'>[]
  rules: Omit<AccrualRule, 'id'>[]
}

const PRESETS: Preset[] = [
  {
    name: 'Mid-month start date cutoff',
    description: 'Before 15th = full month, 15th or later = 0',
    market: '🇩🇪 🇮🇹 🇵🇹 LATAM',
    rules: [
      {
        name: 'New hire before 15th → full month',
        priority: 1,
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        condition_groups: [{ logic: 'AND', conditions: [
          { field: 'period.is_first_month', operator: 'is_true', value: true },
          { field: 'employee.start_date.day_of_month', operator: '<', value: 15 },
        ]}],
        action: { type: 'accrue_full' },
        enabled: true,
      },
      {
        name: 'New hire 15th or later → zero',
        priority: 2,
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        condition_groups: [{ logic: 'AND', conditions: [
          { field: 'period.is_first_month', operator: 'is_true', value: true },
          { field: 'employee.start_date.day_of_month', operator: '>=', value: 15 },
        ]}],
        action: { type: 'accrue_zero' },
        enabled: true,
      },
    ],
  },
  {
    name: 'Reduced accrual during sick leave',
    description: 'Accrue 80% while on sick leave',
    market: '🇫🇷 🇩🇪',
    rules: [
      {
        name: 'Sick leave → 80% accrual',
        priority: 1,
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        condition_groups: [{ logic: 'AND', conditions: [
          { field: 'employee.is_on_leave', operator: 'is_true', value: true },
          { field: 'employee.current_leave_type', operator: '==', value: 'sick_leave' },
        ]}],
        action: { type: 'accrue_percentage', percentage: 80 },
        enabled: true,
      },
      {
        name: 'Long sick leave (>30 days) → 50% accrual',
        priority: 2,
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        condition_groups: [{ logic: 'AND', conditions: [
          { field: 'employee.is_on_leave', operator: 'is_true', value: true },
          { field: 'employee.current_leave_type', operator: '==', value: 'sick_leave' },
          { field: 'employee.leave_duration_days', operator: '>', value: 30 },
        ]}],
        action: { type: 'accrue_percentage', percentage: 50 },
        enabled: true,
      },
    ],
  },
  {
    name: '13-week avg hours (DACH)',
    description: 'Variable-schedule workers accrue based on 13-week actual hours average',
    market: '🇩🇪',
    computed_fields: [
      { name: 'avg_hours_13w', source: 'attendance.worked_hours', aggregation: 'average', window: '13_weeks' },
    ],
    rules: [
      {
        name: 'Variable schedule → accrue by 13w avg',
        priority: 1,
        scope: { legal_entities: [], contract_types: ['hourly'], leave_types: [] },
        condition_groups: [{ logic: 'AND', conditions: [
          { field: 'employee.work_schedule', operator: '==', value: 'variable' },
        ]}],
        action: { type: 'accrue_by_computed_field', computed_field: 'avg_hours_13w', formula: '(computed.avg_hours_13w / full_time_weekly_hours) * base_entitlement' },
        enabled: true,
      },
    ],
  },
  {
    name: 'Monthly schedule (CEGID/France)',
    description: 'Different accrual amounts per month for payroll alignment',
    market: '🇫🇷',
    rules: [
      {
        name: 'Custom monthly distribution',
        priority: 1,
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        condition_groups: [],
        action: { type: 'accrue_monthly_schedule', schedule: { '1': 250, '2': 250, '3': 250, '4': 200, '5': 200, '6': 200, '7': 0, '8': 0, '9': 250, '10': 250, '11': 250, '12': 100 } },
        enabled: true,
      },
    ],
  },
  {
    name: 'FTE % scaling',
    description: 'Part-time employees get proportional entitlement',
    market: '🇩🇪',
    rules: [
      {
        name: 'Part-time → scale by FTE %',
        priority: 1,
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        condition_groups: [{ logic: 'AND', conditions: [
          { field: 'employee.fte_percentage', operator: '<', value: 100 },
        ]}],
        action: { type: 'multiply_by_fte' },
        enabled: true,
      },
    ],
  },
  {
    name: 'Tenure bonus tiers',
    description: 'Extra days at 3 and 5 years seniority',
    market: 'Global',
    rules: [
      {
        name: '3+ years → +2 bonus days',
        priority: 1,
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        condition_groups: [{ logic: 'AND', conditions: [
          { field: 'employee.tenure_years', operator: '>=', value: 3 },
        ]}],
        action: { type: 'add_bonus', amount: 200, unit: 'cents' },
        enabled: true,
      },
      {
        name: '5+ years → +5 bonus days total',
        priority: 2,
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        condition_groups: [{ logic: 'AND', conditions: [
          { field: 'employee.tenure_years', operator: '>=', value: 5 },
        ]}],
        action: { type: 'add_bonus', amount: 500, unit: 'cents' },
        enabled: true,
      },
    ],
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

let nextId = 1
function genId() { return String(nextId++) }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ─── Components ──────────────────────────────────────────────────────────────

function ConditionRow({ condition, onChange, onRemove }: {
  condition: Condition
  onChange: (c: Condition) => void
  onRemove: () => void
}) {
  const fieldDef = CONDITION_FIELDS.find((f) => f.value === condition.field)
  const needsValue = !['is_true', 'is_false'].includes(condition.operator)

  return (
    <div className="flex items-center gap-1.5 flex-wrap bg-gray-50 dark:bg-gray-700/30 rounded-lg p-2">
      <select
        className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 flex-1 min-w-[180px]"
        value={condition.field}
        onChange={(e) => onChange({ ...condition, field: e.target.value })}
      >
        <option value="">Select field...</option>
        {['Employee', 'Absence', 'Period', 'Computed'].map((cat) => (
          <optgroup key={cat} label={cat}>
            {CONDITION_FIELDS.filter((f) => f.category === cat).map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <select
        className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-[100px]"
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value })}
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {needsValue && (
        <input
          type="text"
          className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-28"
          value={String(condition.value ?? '')}
          placeholder={fieldDef?.hint || 'value'}
          onChange={(e) => {
            const raw = e.target.value
            // Try to parse as number, keep as string otherwise
            const v = raw === '' ? '' : isNaN(Number(raw)) ? raw : Number(raw)
            onChange({ ...condition, value: v })
          }}
        />
      )}
      {fieldDef?.hint && needsValue && (
        <span className="text-[10px] text-gray-400 hidden sm:inline">{fieldDef.hint}</span>
      )}
      <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-sm font-bold px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20">✕</button>
    </div>
  )
}

function ConditionGroupEditor({ group, onChange, onRemove, groupIndex }: {
  group: ConditionGroup
  onChange: (g: ConditionGroup) => void
  onRemove: () => void
  groupIndex: number
}) {
  const addCondition = () => {
    onChange({ ...group, conditions: [...group.conditions, { field: '', operator: '==', value: '' }] })
  }
  const updateCondition = (idx: number, c: Condition) => {
    const updated = [...group.conditions]
    updated[idx] = c
    onChange({ ...group, conditions: updated })
  }
  const removeCondition = (idx: number) => {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== idx) })
  }

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-white/50 dark:bg-gray-800/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase">Group {groupIndex + 1}</span>
          <button
            onClick={() => onChange({ ...group, logic: group.logic === 'AND' ? 'OR' : 'AND' })}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${group.logic === 'AND' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}
          >
            {group.logic}
          </button>
          <span className="text-[10px] text-gray-400">click to toggle</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={addCondition} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium px-2 py-0.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20">+ condition</button>
          <button onClick={onRemove} className="text-[10px] text-red-400 hover:text-red-600 px-1">✕ group</button>
        </div>
      </div>
      {group.conditions.length === 0 && (
        <p className="text-[10px] text-gray-400 italic py-1">Empty group — add conditions</p>
      )}
      <div className="space-y-1.5">
        {group.conditions.map((c, idx) => (
          <div key={idx}>
            {idx > 0 && <div className="text-[10px] text-center text-gray-400 font-medium py-0.5">{group.logic}</div>}
            <ConditionRow condition={c} onChange={(updated) => updateCondition(idx, updated)} onRemove={() => removeCondition(idx)} />
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthlyScheduleEditor({ schedule, onChange }: {
  schedule: Record<string, number>
  onChange: (s: Record<string, number>) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2">
      {MONTHS.map((m, idx) => (
        <div key={idx} className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500 w-7">{m}</span>
          <input
            type="number"
            className="w-full border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 text-[11px] bg-white dark:bg-gray-800"
            value={schedule[String(idx + 1)] ?? 0}
            onChange={(e) => onChange({ ...schedule, [String(idx + 1)]: Number(e.target.value) })}
          />
        </div>
      ))}
      <div className="col-span-4 text-[10px] text-gray-400 mt-1">Values in cents (100 = 1 day)</div>
    </div>
  )
}

function ActionEditor({ action, onChange }: {
  action: RuleAction
  onChange: (a: RuleAction) => void
}) {
  return (
    <div className="space-y-2">
      <select
        className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800"
        value={action.type}
        onChange={(e) => onChange({ ...action, type: e.target.value })}
      >
        {ACTION_TYPES.map((a) => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>
      {action.type === 'accrue_fixed' && (
        <div className="flex items-center gap-2">
          <input type="number" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-24" value={Number(action.amount ?? 0)} onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })} />
          <span className="text-[10px] text-gray-500">cents (100 = 1 day)</span>
        </div>
      )}
      {action.type === 'accrue_percentage' && (
        <div className="flex items-center gap-2">
          <input type="number" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-20" value={action.percentage ?? 100} onChange={(e) => onChange({ ...action, percentage: Number(e.target.value) })} />
          <span className="text-[10px] text-gray-500">% of normal accrual</span>
        </div>
      )}
      {action.type === 'add_bonus' && (
        <div className="flex items-center gap-2">
          <input type="number" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-24" value={Number(action.amount ?? 0)} onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })} />
          <span className="text-[10px] text-gray-500">cents bonus added</span>
        </div>
      )}
      {action.type === 'set_entitlement' && (
        <div className="flex items-center gap-2">
          <input type="number" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-24" value={Number(action.amount ?? 0)} onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })} />
          <span className="text-[10px] text-gray-500">cents total entitlement</span>
        </div>
      )}
      {action.type === 'accrue_by_formula' && (
        <div>
          <input type="text" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 font-mono" value={action.formula ?? ''} placeholder="(computed.avg_hours_13w / 40) * base_entitlement" onChange={(e) => onChange({ ...action, formula: e.target.value })} />
          <p className="text-[10px] text-gray-400 mt-1">Variables: base_entitlement, full_time_weekly_hours, computed.*</p>
        </div>
      )}
      {action.type === 'accrue_by_computed_field' && (
        <div className="space-y-2">
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={action.computed_field ?? ''} onChange={(e) => onChange({ ...action, computed_field: e.target.value })}>
            <option value="">Select computed field...</option>
            <option value="avg_hours_13w">Avg hours (13 weeks)</option>
            <option value="avg_hours_4w">Avg hours (4 weeks)</option>
            <option value="total_days_worked_month">Days worked this month</option>
          </select>
          <input type="text" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 font-mono" value={action.formula ?? ''} placeholder="(computed.avg_hours_13w / 40) * base_entitlement" onChange={(e) => onChange({ ...action, formula: e.target.value })} />
        </div>
      )}
      {action.type === 'accrue_monthly_schedule' && (
        <MonthlyScheduleEditor schedule={action.schedule ?? {}} onChange={(s) => onChange({ ...action, schedule: s })} />
      )}
    </div>
  )
}

function RuleCard({ rule, onUpdate, onRemove, onDuplicate, onMoveUp, onMoveDown, isFirst, isLast }: {
  rule: AccrualRule
  onUpdate: (r: AccrualRule) => void
  onRemove: () => void
  onDuplicate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const addGroup = () => {
    onUpdate({ ...rule, condition_groups: [...rule.condition_groups, { logic: 'AND', conditions: [{ field: '', operator: '==', value: '' }] }] })
  }
  const updateGroup = (idx: number, g: ConditionGroup) => {
    const updated = [...rule.condition_groups]
    updated[idx] = g
    onUpdate({ ...rule, condition_groups: updated })
  }
  const removeGroup = (idx: number) => {
    onUpdate({ ...rule, condition_groups: rule.condition_groups.filter((_, i) => i !== idx) })
  }

  return (
    <div className={`border rounded-xl p-4 shadow-sm transition-all ${rule.enabled ? 'border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800' : 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-850 opacity-50'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-1">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onUpdate({ ...rule, enabled: e.target.checked })}
            className="w-4 h-4 accent-indigo-600"
          />
          <input
            type="text"
            value={rule.name}
            onChange={(e) => onUpdate({ ...rule, name: e.target.value })}
            className="flex-1 font-semibold text-sm bg-transparent border-none outline-none text-gray-900 dark:text-gray-100"
            placeholder="Rule name..."
          />
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={onMoveUp} disabled={isFirst} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs px-1.5 py-1" title="Move up">▲</button>
          <button onClick={onMoveDown} disabled={isLast} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs px-1.5 py-1" title="Move down">▼</button>
          <button onClick={onDuplicate} className="text-gray-400 hover:text-indigo-600 text-xs px-1.5 py-1" title="Duplicate">⧉</button>
          <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">✕</button>
        </div>
      </div>

      {/* Condition Groups */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">IF (condition groups joined by AND)</span>
          <button onClick={addGroup} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium px-2 py-0.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20">+ Add group</button>
        </div>
        {rule.condition_groups.length === 0 && (
          <p className="text-[10px] text-gray-400 italic bg-gray-50 dark:bg-gray-700/30 rounded-lg p-2">No conditions = always applies to all employees</p>
        )}
        <div className="space-y-2">
          {rule.condition_groups.map((g, idx) => (
            <div key={idx}>
              {idx > 0 && <div className="text-[10px] text-center text-gray-500 font-bold py-1">AND</div>}
              <ConditionGroupEditor group={g} onChange={(updated) => updateGroup(idx, updated)} onRemove={() => removeGroup(idx)} groupIndex={idx} />
            </div>
          ))}
        </div>
      </div>

      {/* Action */}
      <div>
        <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">THEN</span>
        <ActionEditor action={rule.action} onChange={(a) => onUpdate({ ...rule, action: a })} />
      </div>
    </div>
  )
}

function ComputedFieldsPanel({ fields, onChange }: {
  fields: ComputedField[]
  onChange: (f: ComputedField[]) => void
}) {
  const addField = () => {
    onChange([...fields, { id: genId(), name: '', source: 'attendance.worked_hours', aggregation: 'average', window: '13_weeks' }])
  }
  const removeField = (idx: number) => {
    onChange(fields.filter((_, i) => i !== idx))
  }
  const updateField = (idx: number, updates: Partial<ComputedField>) => {
    const updated = [...fields]
    updated[idx] = { ...updated[idx], ...updates }
    onChange(updated)
  }

  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded-xl p-4 bg-amber-50/50 dark:bg-amber-900/10 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <span>📊</span> Computed Fields
          <span className="text-[10px] font-normal text-gray-500">(derived from attendance/time data)</span>
        </h3>
        <button onClick={addField} className="text-[10px] text-amber-700 dark:text-amber-400 hover:text-amber-900 font-medium px-2 py-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30">+ Add</button>
      </div>
      {fields.length === 0 && (
        <p className="text-[10px] text-gray-400 italic">No computed fields. Add one to use rolling averages or attendance-based metrics in rules.</p>
      )}
      <div className="space-y-2">
        {fields.map((f, idx) => (
          <div key={f.id} className="flex items-center gap-2 flex-wrap bg-white dark:bg-gray-800 rounded-lg p-2 border border-amber-200 dark:border-amber-800">
            <input type="text" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 w-32" value={f.name} placeholder="field name" onChange={(e) => updateField(idx, { name: e.target.value })} />
            <select className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800" value={f.source} onChange={(e) => updateField(idx, { source: e.target.value })}>
              <option value="attendance.worked_hours">Worked hours</option>
              <option value="attendance.worked_days">Worked days</option>
              <option value="timeoff.sick_days">Sick days taken</option>
              <option value="timeoff.leave_days">Leave days taken</option>
            </select>
            <select className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800" value={f.aggregation} onChange={(e) => updateField(idx, { aggregation: e.target.value })}>
              <option value="average">Average</option>
              <option value="sum">Sum</option>
              <option value="count">Count</option>
              <option value="max">Max</option>
            </select>
            <select className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800" value={f.window} onChange={(e) => updateField(idx, { window: e.target.value })}>
              <option value="4_weeks">4 weeks</option>
              <option value="13_weeks">13 weeks</option>
              <option value="26_weeks">26 weeks</option>
              <option value="52_weeks">52 weeks</option>
              <option value="current_month">Current month</option>
              <option value="ytd">Year to date</option>
            </select>
            <button onClick={() => removeField(idx)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function BaseConfigPanel({ config, onChange }: {
  config: BaseConfig
  onChange: (c: BaseConfig) => void
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800 shadow-sm">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <span>⚙️</span> Base Policy Configuration
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Cycle</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.cycle} onChange={(e) => onChange({ ...config, cycle: e.target.value })}>
            <option value="jan_dec">Jan - Dec</option>
            <option value="apr_mar">Apr - Mar</option>
            <option value="employee_hired_date">Hire-date anniversary</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Base amount (cents)</label>
          <input type="number" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.base_amount_cents} onChange={(e) => onChange({ ...config, base_amount_cents: Number(e.target.value) })} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Unit</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.unit_type} onChange={(e) => onChange({ ...config, unit_type: e.target.value })}>
            <option value="working_days">Working days</option>
            <option value="hours">Hours</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Frequency</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.frequency} onChange={(e) => onChange({ ...config, frequency: e.target.value })}>
            <option value="yearly">Yearly</option>
            <option value="monthly">Monthly</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Day counting</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.day_counting} onChange={(e) => onChange({ ...config, day_counting: e.target.value })}>
            <option value="working_days">Working days</option>
            <option value="natural_days">Calendar days</option>
            <option value="french_ouvrables">French ouvrables</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Rounding</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.rounding} onChange={(e) => onChange({ ...config, rounding: e.target.value })}>
            <option value="half_day">Half day</option>
            <option value="decimals">Full precision</option>
            <option value="round_up">Round up</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Carry-over max (cents)</label>
          <input type="number" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.carry_over_max_cents ?? ''} placeholder="null = unlimited" onChange={(e) => onChange({ ...config, carry_over_max_cents: e.target.value ? Number(e.target.value) : null })} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Carry-over expires (months)</label>
          <input type="number" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.carry_over_expire_months ?? ''} placeholder="null = never" onChange={(e) => onChange({ ...config, carry_over_expire_months: e.target.value ? Number(e.target.value) : null })} />
        </div>
      </div>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules] = useState<AccrualRule[]>([])
  const [computedFields, setComputedFields] = useState<ComputedField[]>([])
  const [baseConfig, setBaseConfig] = useState<BaseConfig>({
    cycle: 'jan_dec',
    cycle_length_months: 12,
    base_amount_cents: 2500,
    unit_type: 'working_days',
    frequency: 'yearly',
    day_counting: 'working_days',
    rounding: 'half_day',
    carry_over_max_cents: 500,
    carry_over_expire_months: 3,
    negative_balance_allowed: false,
    negative_balance_limit_cents: null,
    balance_cap_cents: null,
  })
  const [copied, setCopied] = useState(false)

  const addRule = useCallback(() => {
    setRules((prev) => [...prev, {
      id: genId(),
      name: 'New rule',
      priority: prev.length + 1,
      scope: { legal_entities: [], contract_types: [], leave_types: [] },
      condition_groups: [{ logic: 'AND', conditions: [{ field: '', operator: '==', value: '' }] }],
      action: { type: 'accrue_full' },
      enabled: true,
    }])
  }, [])

  const updateRule = useCallback((id: string, updated: AccrualRule) => {
    setRules((prev) => prev.map((r) => r.id === id ? updated : r))
  }, [])

  const removeRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const duplicateRule = useCallback((rule: AccrualRule) => {
    setRules((prev) => [...prev, { ...rule, id: genId(), name: rule.name + ' (copy)', priority: prev.length + 1 }])
  }, [])

  const moveRule = useCallback((idx: number, direction: 'up' | 'down') => {
    setRules((prev) => {
      const arr = [...prev]
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1
      if (targetIdx < 0 || targetIdx >= arr.length) return arr
      ;[arr[idx], arr[targetIdx]] = [arr[targetIdx], arr[idx]]
      return arr.map((r, i) => ({ ...r, priority: i + 1 }))
    })
  }, [])

  const loadPreset = useCallback((preset: Preset) => {
    const newRules = preset.rules.map((r) => ({ ...r, id: genId() }))
    setRules((prev) => [...prev, ...newRules])
    if (preset.computed_fields) {
      const newFields = preset.computed_fields.map((f) => ({ ...f, id: genId() }))
      setComputedFields((prev) => [...prev, ...newFields])
    }
  }, [])

  const generateJSON = () => {
    const output: Record<string, unknown> = {
      version: 2,
      policy: {
        base: baseConfig,
        ...(computedFields.length > 0 && {
          computed_fields: computedFields.map(({ id: _, ...rest }) => rest),
        }),
        rules: rules.filter((r) => r.enabled).map(({ id: _, enabled: __, ...rest }) => rest),
      },
    }
    return JSON.stringify(output, null, 2)
  }

  const jsonOutput = generateJSON()

  const copyToClipboard = () => {
    navigator.clipboard.writeText(jsonOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-indigo-600 dark:text-indigo-400">Accrual Rule Builder v2</h1>
            <p className="text-xs text-gray-500">Composable IF/THEN rules with AND/OR logic, computed fields, and priority ordering</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-full font-medium">
              {rules.length} rule{rules.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left panel */}
        <div className="space-y-4">
          {/* Base config */}
          <BaseConfigPanel config={baseConfig} onChange={setBaseConfig} />

          {/* Computed fields */}
          <ComputedFieldsPanel fields={computedFields} onChange={setComputedFields} />

          {/* Rules */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Conditional Rules <span className="text-[10px] text-gray-400 font-normal">(evaluated top → bottom, first match wins)</span></h2>
            <button onClick={addRule} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">+ Add Rule</button>
          </div>

          {rules.length === 0 && (
            <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <p className="text-gray-500 text-sm mb-2">No conditional rules yet.</p>
              <p className="text-gray-400 text-xs">Add a rule manually or load a preset below.</p>
            </div>
          )}

          <div className="space-y-3">
            {rules.map((rule, idx) => (
              <div key={rule.id} className="relative pl-7">
                <span className="absolute left-0 top-4 text-xs text-gray-400 font-mono w-5 text-right">#{idx + 1}</span>
                <RuleCard
                  rule={rule}
                  onUpdate={(r) => updateRule(rule.id, r)}
                  onRemove={() => removeRule(rule.id)}
                  onDuplicate={() => duplicateRule(rule)}
                  onMoveUp={() => moveRule(idx, 'up')}
                  onMoveDown={() => moveRule(idx, 'down')}
                  isFirst={idx === 0}
                  isLast={idx === rules.length - 1}
                />
              </div>
            ))}
          </div>

          {/* Presets */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Load from real client pains</h2>
            <div className="grid grid-cols-1 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => loadPreset(preset)}
                  className="flex items-center justify-between p-3 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors bg-white dark:bg-gray-800"
                >
                  <div>
                    <div className="text-xs font-medium">{preset.name}</div>
                    <div className="text-[10px] text-gray-500">{preset.description}</div>
                  </div>
                  <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">{preset.market}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel: JSON output */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="bg-gray-900 dark:bg-gray-950 rounded-xl overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-800 dark:bg-gray-900 border-b border-gray-700">
              <span className="text-sm font-medium text-gray-300">Generated Policy JSON</span>
              <button
                onClick={copyToClipboard}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded font-medium transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="p-4 text-xs text-green-400 overflow-auto max-h-[75vh] leading-relaxed">
              <code>{jsonOutput}</code>
            </pre>
          </div>
          <p className="text-[10px] text-gray-500 mt-2 text-center">
            Schema v2 — Rules evaluated top-to-bottom. Condition groups support AND/OR logic. Computed fields derive from attendance data.
          </p>
        </div>
      </div>
    </div>
  )
}
