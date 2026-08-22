export const controlApplicationCommand = {
  name: "vc",
  description: "Control the authorized voice presence deployment",
  type: 1,
  default_member_permissions: "0",
  options: [
    { type: 1, name: "status", description: "Show desired and observed voice state" },
    { type: 1, name: "join", description: "Join the currently authorized target" },
    { type: 1, name: "leave", description: "Leave the authorized target" },
    { type: 1, name: "reconnect", description: "Perform an elevated explicit reconnect" },
    { type: 1, name: "pause", description: "Pause voice connectivity" },
    { type: 1, name: "resume", description: "Resume voice connectivity" },
    {
      type: 1,
      name: "relay",
      description: "Relay one safe plain-text message",
      options: [
        {
          type: 3,
          name: "text",
          description: "Plain text, up to 1,000 characters",
          required: true,
          max_length: 1000
        }
      ]
    },
    { type: 1, name: "diagnostics", description: "Show redacted connection diagnostics" },
    {
      type: 1,
      name: "audit",
      description: "Show recent redacted audit records",
      options: [
        {
          type: 4,
          name: "limit",
          description: "Records to return, from 1 through 50",
          min_value: 1,
          max_value: 50
        }
      ]
    }
  ]
} as const;
