import { classifyOnMessageFn, handleClassifyOnMessage } from "./functions/classify-on-message";
import { firstContactFn, handleFirstContact } from "./functions/first-contact";
import {
  followupSequenceFn,
  handleFollowup,
  resolveFollowupPlan,
} from "./functions/followup-sequence";
import { autoAssignLeadFn, reAssignHotLeadFn, handleAutoAssign, handleReAssignHot } from "./functions/auto-assign";
import { respondOnMessageFn, handleRespondOnMessage } from "./functions/respond-on-message";
import { escalateOnClassifiedFn, handleEscalateOnClassified } from "./functions/escalate-on-classified";

export { inngest } from "./client";
export * from "./events";

export { resolveWhatsappAdapter } from "./whatsapp-adapter";
export type { InstanceForAdapter } from "./whatsapp-adapter";

export { classifyOnMessageFn, handleClassifyOnMessage };
export { firstContactFn, handleFirstContact };
export { followupSequenceFn, handleFollowup, resolveFollowupPlan };
export { autoAssignLeadFn, reAssignHotLeadFn, handleAutoAssign, handleReAssignHot };
export { respondOnMessageFn, handleRespondOnMessage };
export { escalateOnClassifiedFn, handleEscalateOnClassified };

export const functions = [
  classifyOnMessageFn,
  firstContactFn,
  followupSequenceFn,
  autoAssignLeadFn,
  reAssignHotLeadFn,
  respondOnMessageFn,
  escalateOnClassifiedFn,
];
