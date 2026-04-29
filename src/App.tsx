import { useState, useCallback } from 'react'

// ─── Schema Types ────────────────────────────────────────────────────────────

interface Condition {
  field: string
  operator: string
  value: string | number | boolean
}

interface RuleAction {
  type: string
  amount?: number | string
  percentage?: number
  unit?: string
  formula?: string
}

interface Scope {
  legal_entities: string[]
  contract_types: string[]
  leave_types: string[]
}

interface AccrualRule {
  id: string
  name: string
  scope: Scope
  conditions: Condition[]
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

const CONDITION_FIELDS = [
  { value: 'employee.start_date.day_of_month', label: 'Start date - day of month', category: 'Employee' },
  { value: 'employee.tenure_years', label: 'Tenure (years)', category: 'Employee' },
  { value: 'employee.contract_type', label: 'Contract type', category: 'Employee' },
  { value: 'employee.fte_percentage', label: 'FTE %', category: 'Employee' },
  { value: 'employee.hours_worked_avg_13d', label: 'Hours worked (13-day avg)', category: 'Employee' },
  { value: 'employee.is_on_leave', label: 'Currently on leave', category: 'Employee' },
  { value: 'employee.current_leave_type', label: 'Current leave type', category: 'Employee' },
  { value: 'employee.leave_duration_days', label: 'Leave duration (days)', category: 'Employee' },
  { value: 'employee.legal_entity', label: 'Legal entity', category: 'Employee' },
  { value: 'employee.country', label: 'Country', category: 'Employee' },
  { value: 'period.month', label: 'Current month', category: 'Period' },
  { value: 'period.is_first_month', label: 'Is first month of employment', category: 'Period' },
  { value: 'period.is_last_month', label: 'Is last month (termination)', category: 'Period' },
]

const OPERATORS = [
  { value: '<', label: 'less than' },
  { value: '<=', label: 'less than or equal' },
  { value: '>=', label: 'greater than or equal' },
  { value: '>', label: 'greater than' },
  { value: '==', label: 'equals' },
  { value: '!=', label: 'not equals' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is not one of' },
  { value: 'is_true', label: 'is true' },
  { value: 'is_false', label: 'is false' },
]

const ACTION_TYPES = [
  { value: 'accrue_full', label: 'Accrue full entitlement' },
  { value: 'accrue_zero', label: 'Accrue nothing (0)' },
  { value: 'accrue_fixed', label: 'Accrue fixed amount' },
  { value: 'accrue_percentage', label: 'Accrue % of normal' },
  { value: 'accrue_by_formula', label: 'Accrue by formula' },
  { value: 'add_bonus', label: 'Add bonus days' },
  { value: 'set_entitlement', label: 'Set total entitlement to' },
  { value: 'multiply_by_fte', label: 'Multiply by FTE %' },
  { value: 'skip_month', label: 'Skip this month entirely' },
]

// ─── Presets (from real client pains) ────────────────────────────────────────

interface Preset {
  name: string
  description: string
  market: string
  rules: Omit<AccrualRule, 'id'>[]
}

const PRESETS: Preset[] = [
  {
    name: 'Mid-month start date cutoff',
    description: 'Before 15th = full month, 15th or later = 0 for that month',
    market: '🇩🇪 🇮🇹 🇵🇹 LATAM',
    rules: [
      {
        name: 'New hire before 15th → full month',
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        conditions: [
          { field: 'period.is_first_month', operator: 'is_true', value: true },
          { field: 'employee.start_date.day_of_month', operator: '<', value: 15 },
        ],
        action: { type: 'accrue_full' },
        enabled: true,
      },
      {
        name: 'New hire 15th or later → zero',
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        conditions: [
          { field: 'period.is_first_month', operator: 'is_true', value: true },
          { field: 'employee.start_date.day_of_month', operator: '>=', value: 15 },
        ],
        action: { type: 'accrue_zero' },
        enabled: true,
      },
    ],
  },
  {
    name: 'Reduced accrual during sick leave (France)',
    description: 'Accrue 80% while on sick leave',
    market: '🇫🇷',
    rules: [
      {
        name: 'Sick leave → 80% accrual',
        scope: { legal_entities: [], contract_types: [], leave_types: ['sick_leave'] },
        conditions: [
          { field: 'employee.is_on_leave', operator: 'is_true', value: true },
          { field: 'employee.current_leave_type', operator: '==', value: 'sick_leave' },
        ],
        action: { type: 'accrue_percentage', percentage: 80 },
        enabled: true,
      },
    ],
  },
  {
    name: 'Hourly worker accrual (Germany)',
    description: 'Accrue based on % of hours worked vs full-time (13-day rolling avg)',
    market: '🇩🇪',
    rules: [
      {
        name: 'Hourly irregular → proportional to worked hours',
        scope: { legal_entities: [], contract_types: ['hourly'], leave_types: [] },
        conditions: [
          { field: 'employee.contract_type', operator: '==', value: 'hourly' },
        ],
        action: { type: 'accrue_by_formula', formula: '(hours_worked_avg_13d / full_time_daily_hours) * base_entitlement' },
        enabled: true,
      },
    ],
  },
  {
    name: 'Proportional to FTE %',
    description: 'Part-time employees get entitlement scaled by FTE percentage',
    market: '🇩🇪',
    rules: [
      {
        name: 'Scale by FTE %',
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        conditions: [
          { field: 'employee.fte_percentage', operator: '<', value: 100 },
        ],
        action: { type: 'multiply_by_fte' },
        enabled: true,
      },
    ],
  },
  {
    name: 'Tenure bonus (seniority tiers)',
    description: 'Extra days after 3 and 5 years',
    market: 'Global',
    rules: [
      {
        name: '3+ years → +2 bonus days',
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        conditions: [
          { field: 'employee.tenure_years', operator: '>=', value: 3 },
        ],
        action: { type: 'add_bonus', amount: 200, unit: 'cents' },
        enabled: true,
      },
      {
        name: '5+ years → +5 bonus days',
        scope: { legal_entities: [], contract_types: [], leave_types: [] },
        conditions: [
          { field: 'employee.tenure_years', operator: '>=', value: 5 },
        ],
        action: { type: 'add_bonus', amount: 500, unit: 'cents' },
        enabled: true,
      },
    ],
  },
]

// ─── Helper ──────────────────────────────────────────────────────────────────

let nextId = 1
function genId() { return String(nextId++) }

// ─── Components ──────────────────────────────────────────────────────────────

function ConditionRow({ condition, onChange, onRemove }: {
  condition: Condition
  onChange: (c: Condition) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 flex-1 min-w-[160px]"
        value={condition.field}
        onChange={(e) => onChange({ ...condition, field: e.target.value })}
      >
        <option value="">Select field...</option>
        {CONDITION_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{f.category} → {f.label}</option>
        ))}
      </select>
      <select
        className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 min-w-[120px]"
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value })}
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {!['is_true', 'is_false'].includes(condition.operator) && (
        <input
          type="text"
          className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-24"
          value={String(condition.value ?? '')}
          placeholder="value"
          onChange={(e) => {
            const v = isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)
            onChange({ ...condition, value: v })
          }}
        />
      )}
      <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs font-bold px-1">✕</button>
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
          <input type="number" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-24" value={action.amount ?? 0} onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })} />
          <span className="text-xs text-gray-500">cents (100 = 1 day)</span>
        </div>
      )}
      {action.type === 'accrue_percentage' && (
        <div className="flex items-center gap-2">
          <input type="number" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-20" value={action.percentage ?? 100} onChange={(e) => onChange({ ...action, percentage: Number(e.target.value) })} />
          <span className="text-xs text-gray-500">% of normal accrual</span>
        </div>
      )}
      {action.type === 'add_bonus' && (
        <div className="flex items-center gap-2">
          <input type="number" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-24" value={Number(action.amount ?? 0)} onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })} />
          <span className="text-xs text-gray-500">cents bonus</span>
        </div>
      )}
      {action.type === 'set_entitlement' && (
        <div className="flex items-center gap-2">
          <input type="number" className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 w-24" value={Number(action.amount ?? 0)} onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })} />
          <span className="text-xs text-gray-500">cents total</span>
        </div>
      )}
      {action.type === 'accrue_by_formula' && (
        <input type="text" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800 font-mono" value={action.formula ?? ''} placeholder="e.g. (hours_worked / 8) * base_rate" onChange={(e) => onChange({ ...action, formula: e.target.value })} />
      )}
    </div>
  )
}

function RuleCard({ rule, onUpdate, onRemove, onDuplicate }: {
  rule: AccrualRule
  onUpdate: (r: AccrualRule) => void
  onRemove: () => void
  onDuplicate: () => void
}) {
  const addCondition = () => {
    onUpdate({ ...rule, conditions: [...rule.conditions, { field: '', operator: '==', value: '' }] })
  }
  const updateCondition = (idx: number, c: Condition) => {
    const updated = [...rule.conditions]
    updated[idx] = c
    onUpdate({ ...rule, conditions: updated })
  }
  const removeCondition = (idx: number) => {
    onUpdate({ ...rule, conditions: rule.conditions.filter((_, i) => i !== idx) })
  }

  return (
    <div className={`border rounded-xl p-4 shadow-sm transition-all ${rule.enabled ? 'border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 opacity-60'}`}>
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
        <div className="flex items-center gap-1">
          <button onClick={onDuplicate} className="text-gray-400 hover:text-indigo-600 text-xs px-2 py-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20" title="Duplicate">⧉</button>
          <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">Remove</button>
        </div>
      </div>

      {/* Conditions */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">IF (all conditions match)</span>
          <button onClick={addCondition} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ Add condition</button>
        </div>
        {rule.conditions.length === 0 && (
          <p className="text-xs text-gray-400 italic">No conditions = always applies</p>
        )}
        <div className="space-y-2">
          {rule.conditions.map((c, idx) => (
            <ConditionRow key={idx} condition={c} onChange={(updated) => updateCondition(idx, updated)} onRemove={() => removeCondition(idx)} />
          ))}
        </div>
      </div>

      {/* Action */}
      <div>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 block">THEN</span>
        <ActionEditor action={rule.action} onChange={(a) => onUpdate({ ...rule, action: a })} />
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
          <label className="block text-xs text-gray-500 mb-1">Cycle</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.cycle} onChange={(e) => onChange({ ...config, cycle: e.target.value })}>
            <option value="jan_dec">Jan - Dec</option>
            <option value="apr_mar">Apr - Mar</option>
            <option value="employee_hired_date">Hire-date anniversary</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Base amount (cents)</label>
          <input type="number" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.base_amount_cents} onChange={(e) => onChange({ ...config, base_amount_cents: Number(e.target.value) })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Unit</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.unit_type} onChange={(e) => onChange({ ...config, unit_type: e.target.value })}>
            <option value="working_days">Working days</option>
            <option value="hours">Hours</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Frequency</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.frequency} onChange={(e) => onChange({ ...config, frequency: e.target.value })}>
            <option value="yearly">Yearly</option>
            <option value="monthly">Monthly</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Day counting</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.day_counting} onChange={(e) => onChange({ ...config, day_counting: e.target.value })}>
            <option value="working_days">Working days</option>
            <option value="natural_days">Calendar days</option>
            <option value="french_ouvrables">French ouvrables</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rounding</label>
          <select className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.rounding} onChange={(e) => onChange({ ...config, rounding: e.target.value })}>
            <option value="half_day">Half day</option>
            <option value="decimals">Full precision</option>
            <option value="round_up">Round up</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Carry-over max (cents)</label>
          <input type="number" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.carry_over_max_cents ?? ''} placeholder="null = unlimited" onChange={(e) => onChange({ ...config, carry_over_max_cents: e.target.value ? Number(e.target.value) : null })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Carry-over expires (months)</label>
          <input type="number" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-800" value={config.carry_over_expire_months ?? ''} placeholder="null = never" onChange={(e) => onChange({ ...config, carry_over_expire_months: e.target.value ? Number(e.target.value) : null })} />
        </div>
      </div>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules] = useState<AccrualRule[]>([])
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
      scope: { legal_entities: [], contract_types: [], leave_types: [] },
      conditions: [],
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
    setRules((prev) => [...prev, { ...rule, id: genId(), name: rule.name + ' (copy)' }])
  }, [])

  const loadPreset = useCallback((preset: Preset) => {
    const newRules = preset.rules.map((r) => ({ ...r, id: genId() }))
    setRules((prev) => [...prev, ...newRules])
  }, [])

  const generateJSON = () => {
    const output = {
      version: 2,
      policy: {
        base: baseConfig,
        rules: rules.filter((r) => r.enabled).map(({ id: _id, enabled: _e, ...rest }) => rest),
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
            <p className="text-xs text-gray-500">Composable IF/THEN rules — condition → action pipeline</p>
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

          {/* Rules */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Conditional Rules (evaluated in order)</h2>
            <button onClick={addRule} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">+ Add Rule</button>
          </div>

          {rules.length === 0 && (
            <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <p className="text-gray-500 text-sm mb-3">No conditional rules yet.</p>
              <p className="text-gray-400 text-xs">Add a rule or load a preset below to define IF/THEN accrual logic.</p>
            </div>
          )}

          <div className="space-y-3">
            {rules.map((rule, idx) => (
              <div key={rule.id} className="relative">
                <span className="absolute -left-6 top-4 text-xs text-gray-400 font-mono">{idx + 1}</span>
                <RuleCard
                  rule={rule}
                  onUpdate={(r) => updateRule(rule.id, r)}
                  onRemove={() => removeRule(rule.id)}
                  onDuplicate={() => duplicateRule(rule)}
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
                    <div className="text-xs text-gray-500">{preset.description}</div>
                  </div>
                  <span className="text-xs text-gray-400 ml-2">{preset.market}</span>
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
          <p className="text-xs text-gray-500 mt-2 text-center">
            Schema v2 — Rules are evaluated top-to-bottom. First matching rule wins for each accrual period.
          </p>
        </div>
      </div>
    </div>
  )
}
