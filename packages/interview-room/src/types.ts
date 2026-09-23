/** Events streamed by the AI orchestrator over the interview WebSocket. */
export type TurnEvent =
  | { type: 'stt_partial'; text: string }
  | { type: 'stt_final'; text: string }
  | { type: 'ai_text'; text: string }
  | { type: 'tts_audio'; audio_base64: string; text: string }
  | { type: 'backchannel'; text: string }
  | { type: 'telemetry'; telemetry: Record<string, unknown> }
  | { type: 'barge_in'; turn_index: number }
  | { type: 'error'; code: string; message: string };
