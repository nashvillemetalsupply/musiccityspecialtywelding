import { ADS_CONVERSION_SEND_TO } from "@/lib/measurement"
import { dbConfigured, getSql } from "@/lib/db"
import { getOwnerEmail, isAuthorizedCron } from "@/lib/ops-auth"
import { aiConfigured } from "@/lib/ai"
import { gmailConfigured } from "@/lib/gmail"
import {
  checkTwilioProviderReadiness,
  twilioMessagingServiceConfigured,
  twilioPublicNumberEnabled,
  twilioPhoneLoginConfigured,
  twilioSmsConfigured,
  twilioSmsWebhookConfigured,
  twilioInboundWhisperUrl,
  twilioLiveTranscriptionConfigured,
  twilioVoiceConfigured,
  twilioVerifyConfigured,
  twilioWebhookBaseUrl,
} from "@/lib/twilio"
import { callTranscriptionConfigured, deepgramCallbackSecretConfigured } from "@/lib/call-transcription"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { automationRunIsStale, gmailFreshnessWindowMs } from "@/lib/automation-health.mjs"

export const dynamic = "force-dynamic"

// Four days with no web quote is roughly a one-in-a-hundred quiet stretch at
// the shop's observed rate, so it is worth a red build rather than a shrug.
const WEB_QUOTE_SILENCE_LIMIT_HOURS = 96

async function hasWorkingResendCredential(apiKey: string) {
  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function canPersistLeadIntake() {
  if (!dbConfigured()) return false
  try {
    const sql = getSql()
    const privileges = (await sql`
      SELECT
        has_table_privilege(current_user, 'leads', 'INSERT')
        AND has_table_privilege(current_user, 'events', 'INSERT') AS ready`) as Array<{ ready: boolean }>
    if (!privileges[0]?.ready) return false
    // Plan the same two-table durable intake shape used by a real quote. EXPLAIN
    // checks INSERT permissions, required columns, foreign keys, and the event
    // dependency without creating a synthetic customer row.
    await sql`
      EXPLAIN (FORMAT JSON)
      WITH lead_write AS (
        INSERT INTO leads (public_id, first_name, phone, service, is_test, intake_key)
        VALUES ('health-plan-only', '[INTERNAL TEST] health plan', '', 'Health plan', true, 'health-plan-only')
        RETURNING id, person_id
      )
      INSERT INTO events (kind, actor_type, actor_id, lead_id, person_id, external_id, body, crew_body, detail)
      SELECT 'form.quote'::text, 'system'::text, 'health-plan'::text,
        lead_write.id, lead_write.person_id, 'health-plan-only'::text,
        '[INTERNAL TEST] health plan'::text, '[INTERNAL TEST] health plan'::text,
        '{"isTest":true}'::jsonb
      FROM lead_write`
    return true
  } catch {
    return false
  }
}

type DatabaseHealth = {
  configured: boolean
  connected: boolean
  leadCount: number | null
  failedDeliveries: number | null
  lastDigestAt: string | null
  lastDigestOk: boolean | null
  lastReminderAt: string | null
  lastReminderOk: boolean | null
  lastGmailAt: string | null
  lastGmailOk: boolean | null
  lastBriefAt: string | null
  lastBriefOk: boolean | null
  callTranscriptBacklog: number | null
  callTranscriptExhausted: number | null
  voiceTranscriptBacklog: number | null
  uploadRecoveryBacklog: number | null
  quotePhotoBacklog: number | null
  consentRecordCount: number | null
  callSketchErrorCount: number | null
  notificationDeliveryDead: number | null
  notificationDeliveryUnknown: number | null
  messageDeliveryUnknown: number | null
  callDeliveryUnknown: number | null
  lastWebQuoteAt: string | null
}

async function checkDatabase(): Promise<DatabaseHealth> {
  const result: DatabaseHealth = {
    configured: dbConfigured(),
    connected: false,
    leadCount: null,
    failedDeliveries: null,
    lastDigestAt: null,
    lastDigestOk: null,
    lastReminderAt: null,
    lastReminderOk: null,
    lastGmailAt: null,
    lastGmailOk: null,
    lastBriefAt: null,
    lastBriefOk: null,
    callTranscriptBacklog: null,
    callTranscriptExhausted: null,
    voiceTranscriptBacklog: null,
    uploadRecoveryBacklog: null,
    quotePhotoBacklog: null,
    consentRecordCount: null,
    callSketchErrorCount: null,
    notificationDeliveryDead: null,
    notificationDeliveryUnknown: null,
    messageDeliveryUnknown: null,
    callDeliveryUnknown: null,
    lastWebQuoteAt: null,
  }
  if (!result.configured) return result
  try {
    const sql = getSql()
    const [counts] = (await sql`
      SELECT
        (SELECT count(*)::int FROM leads WHERE is_test = false) AS lead_count,
        -- Only /api/quote writes landing_page, so this is the last time the
        -- public form actually reached the database.
        (SELECT max(created_at) FROM leads
          WHERE coalesce(landing_page, '') <> '' AND is_test = false) AS last_web_quote_at,
        (SELECT count(*)::int FROM leads
          WHERE email_delivery_status = 'failed' AND is_test = false) AS failed_deliveries,
        (SELECT count(*)::int FROM calls
          WHERE recording_sid <> '' AND transcript_status IN ('queued','failed','submitting','submitted')
            AND updated_at < now() - interval '30 minutes') AS call_transcript_backlog,
        (SELECT count(*)::int FROM calls
          WHERE recording_sid <> '' AND transcript_status IN ('queued','failed','submitting','submitted')
            AND transcript_attempts >= 8
            AND updated_at < now() - interval '30 minutes') AS call_transcript_exhausted,
        (SELECT count(*)::int FROM voice_transcription_intents
          WHERE status IN ('persisted','queued','failed','submitting')
            AND updated_at < now() - interval '20 minutes') AS voice_transcript_backlog,
        (SELECT count(*)::int FROM glass_uploads
          WHERE status IN ('uploading','uploaded','projecting','unknown')
            AND updated_at < now() - interval '20 minutes') AS upload_recovery_backlog,
        (SELECT count(*)::int FROM lead_photo_intents
          WHERE status <> 'attached'
            AND updated_at < now() - interval '20 minutes') AS quote_photo_backlog,
        (SELECT count(*)::int FROM messaging_consents) AS consent_record_count,
        (SELECT count(*)::int FROM call_sketches
          WHERE status = 'error' AND updated_at > now() - interval '24 hours') AS call_sketch_error_count,
        (SELECT count(*)::int FROM notifications n
          LEFT JOIN events e ON e.id = n.source_event_id
          LEFT JOIN leads l ON l.id = e.lead_id
          LEFT JOIN people p ON p.id = e.person_id
          WHERE n.delivery_status = 'dead' AND n.read_at IS NULL
            AND COALESCE(l.is_test, false) = false
            AND COALESCE(p.is_test, false) = false
            AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true') AS notification_delivery_dead,
        (SELECT count(*)::int FROM notifications n
          LEFT JOIN events e ON e.id = n.source_event_id
          LEFT JOIN leads l ON l.id = e.lead_id
          LEFT JOIN people p ON p.id = e.person_id
          WHERE n.delivery_status = 'unknown' AND n.read_at IS NULL
            AND COALESCE(l.is_test, false) = false
            AND COALESCE(p.is_test, false) = false
            AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true') AS notification_delivery_unknown,
        (SELECT count(*)::int FROM messages m
          LEFT JOIN leads l ON l.id = m.lead_id
          LEFT JOIN people p ON p.id = m.person_id
          WHERE m.status = 'unknown'
            AND COALESCE(l.is_test, false) = false
            AND COALESCE(p.is_test, false) = false) AS message_delivery_unknown,
        (SELECT count(*)::int FROM calls c
          LEFT JOIN leads l ON l.id = c.lead_id
          LEFT JOIN people p ON p.id = c.person_id
          WHERE c.status = 'unknown'
            AND COALESCE(l.is_test, false) = false
            AND COALESCE(p.is_test, false) = false
            AND lower(COALESCE(c.detail->>'isTest', 'false')) <> 'true') AS call_delivery_unknown`) as {
      lead_count: number
      last_web_quote_at: string | null
      failed_deliveries: number
      call_transcript_backlog: number
      call_transcript_exhausted: number
      voice_transcript_backlog: number
      upload_recovery_backlog: number
      quote_photo_backlog: number
      consent_record_count: number
      call_sketch_error_count: number
      notification_delivery_dead: number
      notification_delivery_unknown: number
      message_delivery_unknown: number
      call_delivery_unknown: number
    }[]
    result.connected = true
    result.leadCount = counts.lead_count
    result.lastWebQuoteAt = counts.last_web_quote_at
      ? new Date(counts.last_web_quote_at).toISOString()
      : null
    result.failedDeliveries = counts.failed_deliveries
    result.callTranscriptBacklog = counts.call_transcript_backlog
    result.callTranscriptExhausted = counts.call_transcript_exhausted
    result.voiceTranscriptBacklog = counts.voice_transcript_backlog
    result.uploadRecoveryBacklog = counts.upload_recovery_backlog
    result.quotePhotoBacklog = counts.quote_photo_backlog
    result.consentRecordCount = counts.consent_record_count
    result.callSketchErrorCount = counts.call_sketch_error_count
    result.notificationDeliveryDead = counts.notification_delivery_dead
    result.notificationDeliveryUnknown = counts.notification_delivery_unknown
    result.messageDeliveryUnknown = counts.message_delivery_unknown
    result.callDeliveryUnknown = counts.call_delivery_unknown
    const digest = (await sql`
      SELECT ran_at, ok FROM automation_runs
      WHERE job = 'daily-digest' ORDER BY ran_at DESC LIMIT 1`) as {
      ran_at: string
      ok: boolean
    }[]
    if (digest.length) {
      result.lastDigestAt = new Date(digest[0].ran_at).toISOString()
      result.lastDigestOk = digest[0].ok
    }
    const reminder = (await sql`
      SELECT ran_at, ok FROM automation_runs
      WHERE job = 'follow-up-reminders' ORDER BY ran_at DESC LIMIT 1`) as {
      ran_at: string
      ok: boolean
    }[]
    if (reminder.length) {
      result.lastReminderAt = new Date(reminder[0].ran_at).toISOString()
      result.lastReminderOk = reminder[0].ok
    }
    const integrations = (await sql`
      SELECT DISTINCT ON (job) job, ran_at, ok FROM automation_runs
      WHERE job IN ('gmail-ingest', 'morning-brief')
      ORDER BY job, ran_at DESC`) as { job: string; ran_at: string; ok: boolean }[]
    for (const run of integrations) {
      if (run.job === "gmail-ingest") { result.lastGmailAt = new Date(run.ran_at).toISOString(); result.lastGmailOk = run.ok }
      if (run.job === "morning-brief") { result.lastBriefAt = new Date(run.ran_at).toISOString(); result.lastBriefOk = run.ok }
    }
  } catch {
    result.connected = false
  }
  return result
}

export async function GET(req: Request) {
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ""
  const quoteEmailConfigured = Boolean(
    resendApiKey &&
      process.env.QUOTE_FROM_EMAIL?.trim() &&
      process.env.QUOTE_TO_EMAIL?.trim()
  )
  if (!isAuthorizedCron(req)) {
    const leadsAccepted = await canPersistLeadIntake()
    const ready = leadsAccepted && quoteEmailConfigured
    return Response.json(
      {
        ok: ready,
        service: "music-city-specialty-welding-website",
        leadsAccepted,
      },
      {
        status: ready ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }
  const [quoteEmailCredentialValid, database, twilioProvider] = await Promise.all([
    quoteEmailConfigured ? hasWorkingResendCredential(resendApiKey) : Promise.resolve(false),
    checkDatabase(),
    checkTwilioProviderReadiness(),
  ])
  const adsConversionConfigured = Boolean(ADS_CONVERSION_SEND_TO)
  // The Ads conversion action only ever hears from the public quote form, so a
  // long silence on that form is indistinguishable from a dead tag -- and that
  // silence ran eleven days from 2026-08-24 with nothing watching it. Report it
  // so the health monitor can fail on the outcome, not only on configuration.
  const webQuoteSilenceHours = database.lastWebQuoteAt
    ? Math.floor((Date.now() - new Date(database.lastWebQuoteAt).getTime()) / 3_600_000)
    : null
  const webQuoteSilent = database.connected
    && (webQuoteSilenceHours === null || webQuoteSilenceHours >= WEB_QUOTE_SILENCE_LIMIT_HOURS)
  const analyticsMeasurementConfigured = Boolean(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()
  )
  const opsAuthConfigured = Boolean(getOwnerEmail()) && database.connected
  const cronSecretConfigured = Buffer.byteLength(process.env.CRON_SECRET?.trim() ?? "", "utf8") >= 32
  const resendWebhookConfigured = Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim())
  const glassTokenSecretConfigured = Buffer.byteLength(process.env.GLASS_TOKEN_SECRET?.trim() ?? "", "utf8") >= 32
  const punchSecretConfigured = Buffer.byteLength(process.env.OPS_PUNCH_SECRET?.trim() ?? "", "utf8") >= 32
  const shopBrainRequired = process.env.SHOP_BRAIN_REQUIRED?.trim().toLowerCase() === "true"
  const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim())
  const publicNumberEnabled = twilioPublicNumberEnabled()
  const messagingServiceConfigured = twilioMessagingServiceConfigured()
  const smsWebhookConfigured = twilioSmsWebhookConfigured()
  const smsConfigured = twilioSmsConfigured()
  const verifyConfigured = twilioVerifyConfigured()
  const voiceConfigured = twilioVoiceConfigured()
  const liveTranscriptionConfigured = twilioLiveTranscriptionConfigured()
  const inboundWhisperConfigured = Boolean(twilioInboundWhisperUrl())
  const callSketchPublicEnabled = process.env.CALL_SKETCH_PUBLIC_ENABLED?.trim().toLowerCase() === "true"
  const webhookBaseConfigured = Boolean(twilioWebhookBaseUrl())
  const providerVoiceReady = Boolean(
    twilioProvider.checked &&
      twilioProvider.credentialsValid &&
      twilioProvider.numberFound &&
      twilioProvider.voiceCapable &&
      twilioProvider.voiceWebhookMatches &&
      twilioProvider.voiceFallbackProviderHosted
  )
  const providerMessagingReady = Boolean(
    twilioProvider.checked &&
      twilioProvider.credentialsValid &&
      twilioProvider.numberFound &&
      twilioProvider.smsCapable &&
      twilioProvider.mmsCapable &&
      twilioProvider.messagingServiceFound &&
      twilioProvider.messagingInboundWebhookMatches &&
      twilioProvider.messagingStatusCallbackMatches &&
      twilioProvider.numberInSenderPool
  )
  const centralHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date()))
  const reminderStale = database.lastReminderAt === null ? centralHour >= 2 : Date.now() - new Date(database.lastReminderAt).getTime() > 3 * 60 * 60 * 1000
  const digestStale = database.lastDigestAt === null ? centralHour >= 8 : Date.now() - new Date(database.lastDigestAt).getTime() > 26 * 60 * 60 * 1000
  // GitHub schedules Gmail every 15 minutes from 12:00-23:59 UTC and hourly
  // overnight. Scheduled runs can be delayed under load, so the readiness
  // window must follow the real cadence instead of declaring a healthy hourly
  // run stale after 20 minutes.
  const gmailStale = automationRunIsStale(database.lastGmailAt, gmailFreshnessWindowMs())
  const morningBriefStale = database.lastBriefAt === null ? centralHour >= 8 : Date.now() - new Date(database.lastBriefAt).getTime() > 26 * 60 * 60 * 1000
  const reminderHealthy = !reminderStale && (database.lastReminderOk === true || database.lastReminderAt === null)
  const digestHealthy = !digestStale && (database.lastDigestOk === true || database.lastDigestAt === null)
  const briefHealthy = !morningBriefStale && (database.lastBriefOk === true || database.lastBriefAt === null)
  const durableFailuresHealthy = (
    (database.notificationDeliveryDead ?? 0) === 0 &&
    (database.notificationDeliveryUnknown ?? 0) === 0 &&
    (database.messageDeliveryUnknown ?? 0) === 0 &&
    (database.callDeliveryUnknown ?? 0) === 0
  )
  const shopBrainReady = (
    database.connected &&
    database.consentRecordCount !== null &&
    cronSecretConfigured &&
    webhookBaseConfigured &&
    voiceConfigured &&
    providerVoiceReady &&
    publicNumberEnabled &&
    messagingServiceConfigured &&
    smsWebhookConfigured &&
    smsConfigured &&
    providerMessagingReady &&
    blobConfigured &&
    callTranscriptionConfigured() &&
    voiceTranscriptionConfigured() &&
    gmailConfigured() &&
    aiConfigured() &&
    resendWebhookConfigured &&
    glassTokenSecretConfigured &&
    punchSecretConfigured &&
    reminderHealthy &&
    digestHealthy &&
    database.lastGmailOk === true &&
    briefHealthy &&
    !gmailStale &&
    !morningBriefStale &&
    (database.callTranscriptBacklog ?? 0) === 0 &&
    (database.voiceTranscriptBacklog ?? 0) === 0 &&
    (database.uploadRecoveryBacklog ?? 0) === 0 &&
    (database.quotePhotoBacklog ?? 0) === 0 &&
    durableFailuresHealthy
  )
  const shopBrainGateSatisfied = !shopBrainRequired || shopBrainReady

  // Quote intake fails closed before provider calls unless the durable lead and
  // email intent are persisted, so database readiness is the acceptance gate.
  const leadsAccepted = database.connected

  const launchGatePassed =
    quoteEmailConfigured &&
    quoteEmailCredentialValid &&
    adsConversionConfigured &&
    database.configured &&
    database.connected &&
    (database.failedDeliveries ?? 0) === 0 &&
    shopBrainGateSatisfied

  return Response.json(
    {
      ok: launchGatePassed,
      service: "music-city-specialty-welding-website",
      leadsAccepted,
      email: {
        configured: quoteEmailConfigured,
        credentialValid: quoteEmailCredentialValid,
      },
      database: {
        configured: database.configured,
        connected: database.connected,
      },
      delivery: {
        failedCount: database.failedDeliveries,
      },
      operations: {
        authConfigured: opsAuthConfigured,
        schedulerSecretConfigured: cronSecretConfigured,
      },
      automation: {
        lastDigestAt: database.lastDigestAt,
        lastDigestOk: database.lastDigestOk,
        lastReminderAt: database.lastReminderAt,
        lastReminderOk: database.lastReminderOk,
        lastGmailAt: database.lastGmailAt,
        lastGmailOk: database.lastGmailOk,
        lastBriefAt: database.lastBriefAt,
        lastBriefOk: database.lastBriefOk,
        // Surfaces a silently-disabled GitHub schedule once reminders have run at least once.
        reminderStale,
        digestStale,
        gmailStale: gmailConfigured() && gmailStale,
        morningBriefStale,
      },
      shopBrain: {
        required: shopBrainRequired,
        ready: shopBrainReady,
        gateSatisfied: shopBrainGateSatisfied,
        twilioSmsConfigured: smsConfigured,
        twilioVerifyConfigured: verifyConfigured,
        phoneLoginConfigured: twilioPhoneLoginConfigured(),
        twilioSmsWebhookConfigured: smsWebhookConfigured,
        twilioVoiceConfigured: voiceConfigured,
        twilioInboundWhisperConfigured: inboundWhisperConfigured,
        twilioLiveTranscriptionConfigured: liveTranscriptionConfigured,
        callSketchPublicEnabled,
        callSketchRecentErrors: database.callSketchErrorCount,
        twilioWebhookBaseConfigured: webhookBaseConfigured,
        publicNumberEnabled,
        messagingServiceConfigured,
        twilioProvider: {
          checked: twilioProvider.checked,
          credentialsValid: twilioProvider.credentialsValid,
          numberFound: twilioProvider.numberFound,
          voiceCapable: twilioProvider.voiceCapable,
          smsCapable: twilioProvider.smsCapable,
          mmsCapable: twilioProvider.mmsCapable,
          voiceWebhookMatches: twilioProvider.voiceWebhookMatches,
          voiceFallbackProviderHosted: twilioProvider.voiceFallbackProviderHosted,
          messagingServiceFound: twilioProvider.messagingServiceFound,
          messagingInboundWebhookMatches: twilioProvider.messagingInboundWebhookMatches,
          messagingStatusCallbackMatches: twilioProvider.messagingStatusCallbackMatches,
          numberInSenderPool: twilioProvider.numberInSenderPool,
          voiceReady: providerVoiceReady,
          messagingReady: providerMessagingReady,
        },
        consentLedgerReady: database.consentRecordCount !== null,
        blobConfigured,
        uploadRecoveryBacklog: database.uploadRecoveryBacklog,
        quotePhotoBacklog: database.quotePhotoBacklog,
        deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY?.trim()),
        deepgramCallbackSecretConfigured: deepgramCallbackSecretConfigured(),
        callTranscriptionConfigured: callTranscriptionConfigured(),
        voiceTranscriptionConfigured: voiceTranscriptionConfigured(),
        callTranscriptBacklog: database.callTranscriptBacklog,
        callTranscriptExhausted: database.callTranscriptExhausted,
        voiceTranscriptBacklog: database.voiceTranscriptBacklog,
        durableFailures: {
          healthy: durableFailuresHealthy,
          degraded: !durableFailuresHealthy,
          notificationDead: database.notificationDeliveryDead,
          notificationUnknown: database.notificationDeliveryUnknown,
          messageUnknown: database.messageDeliveryUnknown,
          callUnknown: database.callDeliveryUnknown,
        },
        gmailConfigured: gmailConfigured(),
        aiGatewayConfigured: aiConfigured(),
        resendWebhookConfigured,
        glassTokenSecretConfigured,
        punchSecretConfigured,
      },
      googleAds: {
        conversionConfigured: adsConversionConfigured,
        conversionSendTo: ADS_CONVERSION_SEND_TO,
        lastWebQuoteAt: database.lastWebQuoteAt,
        webQuoteSilenceHours,
        webQuoteSilenceLimitHours: WEB_QUOTE_SILENCE_LIMIT_HOURS,
        webQuoteSilent,
      },
      googleAnalytics: {
        measurementConfigured: analyticsMeasurementConfigured,
      },
      reviews: {
        googleReviewUrlConfigured: Boolean(process.env.GOOGLE_REVIEW_URL?.trim()),
      },
      launchGate: {
        passed: launchGatePassed,
        detail: launchGatePassed
          ? "Quote delivery, lead persistence, Ads conversion, and activated MCSW Jobs checks passed."
          : shopBrainRequired && !shopBrainReady
            ? "MCSW Jobs is activated but an ingestion, brief, transcription, or configuration check is degraded."
            : "Quote delivery, lead persistence, or Ads conversion configuration failed.",
      },
    },
    {
      status: launchGatePassed ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
