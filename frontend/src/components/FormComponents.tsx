import React from 'react'

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, hint, className = '', ...props }, ref) => (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-bold text-slate-700">
          {label}
          {props.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <input
        ref={ref}
        className={`w-full px-4 py-2.5 border rounded-xl bg-white text-slate-800 focus:ring-2 focus:ring-coral-500/20 focus:border-coral-400 transition ${
          error ? 'border-red-400' : 'border-gray-200'
        } ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  )
)
FormInput.displayName = 'FormInput'

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  ({ label, error, options, className = '', ...props }, ref) => (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-bold text-slate-700">
          {label}
          {props.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <select
        ref={ref}
        className={`w-full px-4 py-2.5 border rounded-xl bg-white text-slate-800 focus:ring-2 focus:ring-coral-500/20 focus:border-coral-400 transition ${
          error ? 'border-red-400' : 'border-gray-200'
        } ${className}`}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
)
FormSelect.displayName = 'FormSelect'

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const FormTextarea = React.forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ label, error, className = '', ...props }, ref) => (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-bold text-slate-700">
          {label}
          {props.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        className={`w-full px-4 py-2.5 border rounded-xl bg-white text-slate-800 focus:ring-2 focus:ring-coral-500/20 focus:border-coral-400 transition ${
          error ? 'border-red-400' : 'border-gray-200'
        } ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
)
FormTextarea.displayName = 'FormTextarea'

export default FormInput
