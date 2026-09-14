import type { ChatRequestOptions } from '../../types'

import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { ProviderValidationCheck } from '../../types'
import { createOpenAICompatibleValidators } from '../../validators'
import { defineProvider } from '../registry'

const groqConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('https://api.groq.com/openai/v1/'),
})

type GroqConfig = z.input<typeof groqConfigSchema>

export const providerGroq = defineProvider<GroqConfig>({
  id: 'groq',
  name: 'Groq',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.groq.title'),
  description: 'groq.com',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.groq.description'),
  tasks: ['chat'],
  capabilities: { chat: { reasoning: { modes: ['enabled', 'disabled'] } } },
  icon: 'i-lobe-icons:groq',

  createProviderConfig: ({ t }) => groqConfigSchema.extend({
    apiKey: groqConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: groqConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    const provider = createOpenAI(config.apiKey, config.baseUrl)
    return {
      ...provider,
      chat(model: string, options?: ChatRequestOptions) {
        const request = provider.chat(model)

        // Groq's effort scale is model-specific. gpt-oss accepts only
        // `low | medium | high` and rejects anything else with a 400, while
        // `none` exists for the qwen3 family only. Which set applies depends on
        // the model, and models must not be hardcoded in a provider adapter, so
        // "reasoning disabled" omits the field entirely and lets Groq apply the
        // model default instead of sending a value the model may reject.
        // `enabled` keeps the `medium` this adapter has always sent.
        if (options?.reasoning !== 'enabled')
          return request

        return { ...request, reasoningEffort: 'medium' }
      },
    }
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },
  validators: {
    ...createOpenAICompatibleValidators({
      checks: [ProviderValidationCheck.ModelList, ProviderValidationCheck.ChatCompletions],
    }),
  },
})
