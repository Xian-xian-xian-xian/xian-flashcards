export function isTaskClaimEventType(type: unknown) {
  return type === "task_claimed" || type === "task_board_reward_claimed";
}
