import React from 'react'

const sizeClasses = {
  sm: 'px-3 py-2 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3.5 text-base',
}

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  inputSize?: 'sm' | 'md' | 'lg'
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, hint, inputSize = 'md', className = '', ...props }, ref) => (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
          {label}
          {props.required && <span className="text-coral-500 ml-1">*</span>}
        </label>
      )}
      <input
        ref={ref}
        className={`w-full ${sizeClasses[inputSize]} border rounded-xl bg-white text-slate-800 placeholder-slate-400 focus:ring-4 focus:ring-coral-500/10 focus:border-coral-400 transition-all outline-none ${
          error ? 'border-rose-400 focus:ring-rose-500/10 focus:border-rose-400' : 'border-gray-200'
        } ${className}`}
        {...props}
      />
      {error && (
        <p className="text-xs font-medium text-rose-600 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  )
)
FormInput.displayName = 'FormInput'

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  inputSize?: 'sm' | 'md' | 'lg'
}

export const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  ({ label, error, options, inputSize = 'md', className = '', ...props }, ref) => (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
          {label}
          {props.required && <span className="text-coral-500 ml-1">*</span>}
        </label>
      )}
      <select
        ref={ref}
        className={`w-full ${sizeClasses[inputSize]} border rounded-xl bg-white text-slate-800 focus:ring-4 focus:ring-coral-500/10 focus:border-coral-400 transition-all outline-none appearance-none ${
          error ? 'border-rose-400 focus:ring-rose-500/10 focus:border-rose-400' : 'border-gray-200'
        } ${className}`}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-xs font-medium text-rose-600 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  )
)
FormSelect.displayName = 'FormSelect'

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  inputSize?: 'sm' | 'md' | 'lg'
}

export const FormTextarea = React.forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ label, error, inputSize = 'md', className = '', ...props }, ref) => (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
          {label}
          {props.required && <span className="text-coral-500 ml-1">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        className={`w-full ${sizeClasses[inputSize]} border rounded-xl bg-white text-slate-800 placeholder-slate-400 focus:ring-4 focus:ring-coral-500/10 focus:border-coral-400 transition-all outline-none resize-y ${
          error ? 'border-rose-400 focus:ring-rose-500/10 focus:border-rose-400' : 'border-gray-200'
        } ${className}`}
        {...props}
      />
      {error && (
        <p className="text-xs font-medium text-rose-600 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  )
)
FormTextarea.displayName = 'FormTextarea'

export default FormInput
