import { useState, useCallback } from 'react'

// ─── Rule Definitions ────────────────────────────────────────────────────────

interface RuleOption {
  value: string
  label: string
}

interface RuleParam {
  key: string
  label: string
  type: 'select' | 'number' | 'boolean' | 'text'
  options?: RuleOption[]
  default?: string | number | boolean
  placeholder?: string
  condition?: (params: Record<string, unknown>) => boolean
  unit?: string
}

interface RuleCategory {
  id: string
  type: string
  title: string
  description: string
  icon: string
  params: RuleParam[]
}

const RULE_CATEGORIES: RuleCategory[] = [
  {
    id: '1',
    type: 'base_amount',
    title: 'Base Allowance Amount',
    description: 'How much time off employees get per cycle',
    icon: '🎯',
    params: [
      { key: 'amount_in_cents', label: 'Amount', type: 'number', default: 2500, unit: 'cents (100 = 1 day)' },
      { key: 'unit_type', label: 'Unit type', type: 'select', options: [
        { value: 'working_days', label: 'Working days' },
        { value: 'hours', label: 'Hours' },
      ], default: 'working_days' },
      { key: 'unlimited', label: 'Unlimited', type: 'boolean', default: false },
    ],
  },
  {
    id: '2',
    type: 'source_type',
    title: 'Source of Accrued Units',
    description: 'Where do the accrued days/hours come from?',
    icon: '📥',
    params: [
      { key: 'source', label: 'Source', type: 'select', options: [
        { value: 'base_units', label: 'Fixed entitlement' },
        { value: 'overtime_units', label: 'From overtime hours' },
        { value: 'by_worked_time', label: 'Proportional to worked time' },
      ], default: 'base_units' },
      { key: 'formula', label: 'Formula', type: 'select', options: [
        { value: 'standard', label: 'Standard (worked_hours x factor / denominator)' },
        { value: 'uk_pto', label: 'UK PTO pro-ratio (2080h baseline)' },
      ], default: 'standard', condition: (p) => p.source === 'by_worked_time' },
      { key: 'factor', label: 'Factor', type: 'number', default: 1, condition: (p) => p.source === 'by_worked_time' },
      { key: 'denominator', label: 'Denominator', type: 'number', default: 8, condition: (p) => p.source === 'by_worked_time' && p.formula === 'standard' },
    ],
  },
  {
    id: '3',
    type: 'frequency',
    title: 'Accrual Frequency',
    description: 'How often does the allowance renew or reset?',
    icon: '🔄',
    params: [
      { key: 'period', label: 'Period', type: 'select', options: [
        { value: 'yearly', label: 'Yearly (renew full allowance each cycle)' },
        { value: 'monthly_flexible', label: 'Monthly (accrue monthly within cycle)' },
        { value: 'lifetime', label: 'Lifetime (never resets)' },
      ], default: 'yearly' },
    ],
  },
  {
    id: '4',
    type: 'availability',
    title: 'Availability Schedule',
    description: 'When do accrued days become usable?',
    icon: '📅',
    params: [
      { key: 'schedule', label: 'Availability timing', type: 'select', options: [
        { value: 'all_days', label: 'All days from day one' },
        { value: 'generated_days', label: 'Progressive over cycle' },
        { value: 'generated_days_monthly', label: 'Last day of each month' },
        { value: 'generated_days_monthly_first_day', label: '1st of each month' },
        { value: 'monthly_fifteenth', label: '15th of each month' },
        { value: 'mensiversary', label: 'Monthly hire-date anniversary' },
        { value: 'bimonthly_first_and_fifteenth', label: 'Bimonthly: 1st and 15th' },
        { value: 'bimonthly_fifteenth_and_last', label: 'Bimonthly: 15th and last day' },
      ], default: 'all_days' },
      { key: 'available_in', label: 'Available in', type: 'select', options: [
        { value: 'current_cycle', label: 'Current cycle (immediate)' },
        { value: 'next_cycle', label: 'Next cycle only' },
      ], default: 'current_cycle' },
    ],
  },
  {
    id: '5',
    type: 'cycle',
    title: 'Cycle Definition',
    description: 'When does the allowance cycle start and end?',
    icon: '📆',
    params: [
      { key: 'type', label: 'Cycle type', type: 'select', options: [
        { value: 'jan_dec', label: 'January - December' },
        { value: 'feb_jan', label: 'February - January' },
        { value: 'mar_feb', label: 'March - February' },
        { value: 'apr_mar', label: 'April - March' },
        { value: 'may_apr', label: 'May - April' },
        { value: 'jun_may', label: 'June - May' },
        { value: 'jul_jun', label: 'July - June' },
        { value: 'aug_jul', label: 'August - July' },
        { value: 'sep_aug', label: 'September - August' },
        { value: 'oct_sep', label: 'October - September' },
        { value: 'nov_oct', label: 'November - October' },
        { value: 'dec_nov', label: 'December - November' },
        { value: 'employee_hired_date', label: 'Employee hire-date anniversary' },
      ], default: 'jan_dec' },
      { key: 'length_months', label: 'Cycle length (months)', type: 'number', default: 12 },
    ],
  },
  {
    id: '6',
    type: 'proration',
    title: 'Proration',
    description: 'What happens when someone joins mid-cycle?',
    icon: '✂️',
    params: [
      { key: 'enabled', label: 'Proration enabled', type: 'boolean', default: true },
      { key: 'method', label: 'Method', type: 'select', options: [
        { value: 'proportional', label: 'Proportional to remaining time' },
      ], default: 'proportional', condition: (p) => p.enabled === true },
    ],
  },
  {
    id: '7',
    type: 'day_counting',
    title: 'Day Counting Method',
    description: 'How are leave days counted?',
    icon: '🧮',
    params: [
      { key: 'method', label: 'Method', type: 'select', options: [
        { value: 'working_days', label: 'Working days only (skip weekends/rest days)' },
        { value: 'natural_days', label: 'Calendar days (including trailing weekends)' },
        { value: 'natural_days_only_range', label: 'Calendar days (only selected range)' },
        { value: 'french_calendar_days', label: 'French ouvrables (Mon-Sat, skip Sun + holidays)' },
        { value: 'french_ouvres', label: 'French ouvres (Mon-Fri, skip weekends + holidays)' },
      ], default: 'working_days' },
    ],
  },
  {
    id: '8',
    type: 'rounding',
    title: 'Rounding',
    description: 'How are prorated/accrued values rounded?',
    icon: '🔢',
    params: [
      { key: 'method', label: 'Rounding method', type: 'select', options: [
        { value: 'half_day', label: 'Nearest half day' },
        { value: 'decimals', label: 'Full decimal precision' },
        { value: 'quarters', label: 'Nearest quarter day' },
        { value: 'round_up', label: 'Always round up' },
      ], default: 'half_day' },
    ],
  },
  {
    id: '9',
    type: 'carry_over',
    title: 'Carry-Over',
    description: 'What happens to unused days at end of cycle?',
    icon: '📦',
    params: [
      { key: 'unlimited', label: 'Unlimited carry-over', type: 'boolean', default: false },
      { key: 'max_units_in_cents', label: 'Max carry-over', type: 'number', default: 500, unit: 'cents', condition: (p) => !p.unlimited },
      { key: 'expire_in_months', label: 'Expires after (months)', type: 'number', default: 3, placeholder: '0 = never' },
    ],
  },
  {
    id: '10',
    type: 'negative_balance',
    title: 'Negative Balance',
    description: 'Can employees go into negative balance?',
    icon: '⚠️',
    params: [
      { key: 'allowed', label: 'Allow negative balance', type: 'boolean', default: false },
      { key: 'limit_type', label: 'Limit type', type: 'select', options: [
        { value: 'no_limit', label: 'No limit' },
        { value: 'limited', label: 'Limited amount' },
      ], default: 'no_limit', condition: (p) => p.allowed === true },
      { key: 'limit_in_cents', label: 'Limit', type: 'number', default: 300, unit: 'cents', condition: (p) => p.allowed === true && p.limit_type === 'limited' },
    ],
  },
  {
    id: '11',
    type: 'tenure',
    title: 'Tenure / Seniority Tiers',
    description: 'Extra days based on years of service?',
    icon: '🏆',
    params: [
      { key: 'enabled', label: 'Tenure tiers enabled', type: 'boolean', default: false },
      { key: 'transition', label: 'When extra days apply', type: 'select', options: [
        { value: 'after_milestone', label: 'Immediately at milestone' },
        { value: 'beginning_of_cycle', label: 'Start of cycle containing milestone' },
        { value: 'end_of_cycle', label: 'Cycle after milestone' },
      ], default: 'after_milestone', condition: (p) => p.enabled === true },
    ],
  },
  {
    id: '12',
    type: 'manual_adjustments',
    title: 'Manual Adjustments (Incidences)',
    description: 'Admin one-off corrections',
    icon: '✏️',
    params: [
      { key: 'allowed', label: 'Allow manual adjustments', type: 'boolean', default: true },
    ],
  },
  {
    id: '13',
    type: 'balance_cap',
    title: 'Max Balance Cap',
    description: 'Absolute ceiling on total balance?',
    icon: '🚫',
    params: [
      { key: 'enabled', label: 'Enable balance cap', type: 'boolean', default: false },
      { key: 'max_in_cents', label: 'Maximum balance', type: 'number', default: 3000, unit: 'cents', condition: (p) => p.enabled === true },
    ],
  },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveRule {
  categoryId: string
  type: string
  params: Record<string, unknown>
}

// ─── Components ──────────────────────────────────────────────────────────────

function RuleParamInput({ param, value, onChange }: {
  param: RuleParam
  value: unknown
  onChange: (val: unknown) => void
}) {
  switch (param.type) {
    case 'select':
      return (
        <select
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-sm"
          value={String(value ?? param.default ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {param.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-sm"
            value={Number(value ?? param.default ?? 0)}
            placeholder={param.placeholder}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {param.unit && <span className="text-xs text-gray-500 whitespace-nowrap">{param.unit}</span>}
        </div>
      )
    case 'boolean':
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 rounded accent-indigo-600"
            checked={Boolean(value ?? param.default)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-sm">{param.label}</span>
        </label>
      )
    case 'text':
      return (
        <input
          type="text"
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-sm"
          value={String(value ?? param.default ?? '')}
          placeholder={param.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

function RuleCard({ category, rule, onUpdate, onRemove }: {
  category: RuleCategory
  rule: ActiveRule
  onUpdate: (params: Record<string, unknown>) => void
  onRemove: () => void
}) {
  const visibleParams = category.params.filter(
    (p) => !p.condition || p.condition(rule.params)
  )

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{category.icon}</span>
          <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">{category.title}</h3>
        </div>
        <button
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 text-sm font-medium px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          Remove
        </button>
      </div>
      <div className="space-y-3">
        {visibleParams.map((param) => (
          param.type === 'boolean' ? (
            <RuleParamInput
              key={param.key}
              param={param}
              value={rule.params[param.key]}
              onChange={(val) => onUpdate({ ...rule.params, [param.key]: val })}
            />
          ) : (
            <div key={param.key}>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {param.label}
              </label>
              <RuleParamInput
                param={param}
                value={rule.params[param.key]}
                onChange={(val) => onUpdate({ ...rule.params, [param.key]: val })}
              />
            </div>
          )
        ))}
      </div>
    </div>
  )
}

function TenureTiersEditor({ tiers, onChange }: {
  tiers: Array<{ years: number; type: string; adjustment_in_cents: number }>
  onChange: (tiers: Array<{ years: number; type: string; adjustment_in_cents: number }>) => void
}) {
  const addTier = () => {
    onChange([...tiers, { years: 3, type: 'increment', adjustment_in_cents: 200 }])
  }
  const removeTier = (idx: number) => {
    onChange(tiers.filter((_, i) => i !== idx))
  }
  const updateTier = (idx: number, field: string, value: unknown) => {
    const updated = [...tiers]
    updated[idx] = { ...updated[idx], [field]: value }
    onChange(updated)
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Tenure Tiers</span>
        <button onClick={addTier} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ Add Tier</button>
      </div>
      {tiers.map((tier, idx) => (
        <div key={idx} className="flex gap-2 items-center bg-gray-50 dark:bg-gray-700/50 p-2 rounded-lg">
          <input type="number" className="w-16 border rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600" value={tier.years} onChange={(e) => updateTier(idx, 'years', Number(e.target.value))} />
          <span className="text-xs">yrs</span>
          <select className="border rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600" value={tier.type} onChange={(e) => updateTier(idx, 'type', e.target.value)}>
            <option value="increment">+ extra days</option>
            <option value="fixed_balance">Set to fixed</option>
          </select>
          <input type="number" className="w-20 border rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600" value={tier.adjustment_in_cents} onChange={(e) => updateTier(idx, 'adjustment_in_cents', Number(e.target.value))} />
          <span className="text-xs text-gray-500">cents</span>
          <button onClick={() => removeTier(idx)} className="text-red-400 hover:text-red-600 text-xs ml-auto">x</button>
        </div>
      ))}
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [activeRules, setActiveRules] = useState<ActiveRule[]>([])
  const [tenureTiers, setTenureTiers] = useState<Array<{ years: number; type: string; adjustment_in_cents: number }>>([])
  const [copied, setCopied] = useState(false)

  const addRule = useCallback((category: RuleCategory) => {
    if (activeRules.some((r) => r.type === category.type)) return
    const defaults: Record<string, unknown> = {}
    category.params.forEach((p) => {
      if (p.default !== undefined) defaults[p.key] = p.default
    })
    setActiveRules((prev) => [...prev, { categoryId: category.id, type: category.type, params: defaults }])
  }, [activeRules])

  const updateRule = useCallback((type: string, params: Record<string, unknown>) => {
    setActiveRules((prev) => prev.map((r) => r.type === type ? { ...r, params } : r))
  }, [])

  const removeRule = useCallback((type: string) => {
    setActiveRules((prev) => prev.filter((r) => r.type !== type))
  }, [])

  const generateJSON = () => {
    const rules = activeRules.map((r) => {
      const cleaned: Record<string, unknown> = {}
      Object.entries(r.params).forEach(([k, v]) => {
        if (v !== undefined && v !== '' && v !== null) cleaned[k] = v
      })
      const result: { type: string; params: Record<string, unknown> } = { type: r.type, params: cleaned }
      if (r.type === 'tenure' && tenureTiers.length > 0) {
        result.params.tiers = tenureTiers
      }
      return result
    })
    return JSON.stringify({ version: 1, rules }, null, 2)
  }

  const jsonOutput = generateJSON()

  const copyToClipboard = () => {
    navigator.clipboard.writeText(jsonOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const availableCategories = RULE_CATEGORIES.filter(
    (c) => !activeRules.some((r) => r.type === c.type)
  )

  const tenureRule = activeRules.find((r) => r.type === 'tenure')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-indigo-600 dark:text-indigo-400">Accrual Rule Builder</h1>
            <p className="text-xs text-gray-500">Approach A — Composable Rule Engine</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-full font-medium">
              {activeRules.length} rule{activeRules.length !== 1 ? 's' : ''} active
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left panel: Rule Builder */}
        <div className="space-y-4">
          {/* Active rules */}
          {activeRules.length > 0 && (
            <div className="space-y-3">
              {activeRules.map((rule) => {
                const category = RULE_CATEGORIES.find((c) => c.type === rule.type)!
                return (
                  <div key={rule.type}>
                    <RuleCard
                      category={category}
                      rule={rule}
                      onUpdate={(params) => updateRule(rule.type, params)}
                      onRemove={() => removeRule(rule.type)}
                    />
                    {rule.type === 'tenure' && Boolean(tenureRule?.params.enabled) && (
                      <div className="ml-4 mt-2">
                        <TenureTiersEditor tiers={tenureTiers} onChange={setTenureTiers} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Empty state */}
          {activeRules.length === 0 && (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <p className="text-gray-500 text-sm">No rules added yet. Click a rule category below to start building your accrual policy.</p>
            </div>
          )}

          {/* Add rule buttons */}
          {availableCategories.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Add Rules</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => addRule(cat)}
                    className="flex items-center gap-2 p-3 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors bg-white dark:bg-gray-800"
                  >
                    <span className="text-lg">{cat.icon}</span>
                    <div>
                      <div className="text-xs font-medium">{cat.title}</div>
                      <div className="text-xs text-gray-500">{cat.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel: JSON output */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="bg-gray-900 dark:bg-gray-950 rounded-xl overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-800 dark:bg-gray-900 border-b border-gray-700">
              <span className="text-sm font-medium text-gray-300">Generated JSON</span>
              <button
                onClick={copyToClipboard}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded font-medium transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="p-4 text-xs text-green-400 overflow-auto max-h-[70vh] leading-relaxed">
              <code>{jsonOutput}</code>
            </pre>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            This JSON is stored in the <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded text-xs">accrual_rules</code> JSONB column on <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded text-xs">timeoff_allowances</code>.
          </p>
        </div>
      </div>
    </div>
  )
}
