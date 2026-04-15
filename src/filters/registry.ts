import type { FilterKey } from '@/types'

export interface FilterRegistryEntry {
  key: FilterKey
  label: string
}

export const FILTER_REGISTRY: FilterRegistryEntry[] = [
  { key: 'gaussian-blur', label: 'Gaussian Blur…' },
  { key: 'box-blur',      label: 'Box Blur…' },
]
