import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface ColdOutreachProps {
  subject?: string
  body?: string
}

const ColdOutreachEmail = ({ body }: ColdOutreachProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{body?.slice(0, 90) ?? ''}</Preview>
    <Body style={main}>
      <Container style={container}>
        {(body ?? '').split('\n').map((line, i) => (
          <Text key={i} style={text}>{line || '\u00A0'}</Text>
        ))}
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ColdOutreachEmail,
  subject: (data: Record<string, any>) => data.subject ?? 'Quick question',
  displayName: 'Cold outreach',
  previewData: {
    subject: 'Quick question about Acme',
    body: 'Hi Jane,\n\nI noticed Acme is hiring quickly — congrats on the growth.\n\nWe help teams like yours automate cold outreach with AI personalization. Worth a quick chat?\n\nBest,\nEric',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px', maxWidth: '600px' }
const text = { fontSize: '15px', color: '#111111', lineHeight: '1.55', margin: '0 0 12px' }
