#ifndef CG2271_SUPABASE_H
#define CG2271_SUPABASE_H

struct MCXStatus;

struct SupabaseConfig {
  const char* url;
  const char* publishableKey;
  const char* deviceEmail;
  const char* devicePassword;
  const char* deviceId;
  int lightStateThreshold;
  int waterLowCode;
};

// Uses a cached sign-in for one device account. Pass the same configuration
// on each call. Refreshes MCU status from UART before building the reading.
void sendReadingsToSupabase(const SupabaseConfig& config, MCXStatus& mcx);

#endif // CG2271_SUPABASE_H
