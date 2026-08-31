#define _CRT_SECURE_NO_WARNINGS
#include <node_api.h>
#include <atomic>
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>

// Global counters using C++ atomics (no deprecated OSAtomic*).
static std::atomic<int64_t> g_keyDownCount{0};
static std::atomic<int64_t> g_keyUpCount{0};
static void* g_eventTap = nullptr;

// Event tap callback.
CGEventRef KeyboardEventTapCallback(CGEventTapProxy proxy, CGEventType type,
                                     CGEventRef event, void *refcon) {
  (void)proxy;
  (void)refcon;

  if (type == kCGEventKeyDown) {
    g_keyDownCount.fetch_add(1, std::memory_order_relaxed);
  } else if (type == kCGEventKeyUp) {
    g_keyUpCount.fetch_add(1, std::memory_order_relaxed);
  }

  return event;
}

static bool StartEventTap() {
  if (g_eventTap) return true;

  g_eventTap = (void*)CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
                                        kCGEventTapOptionListenOnly,
                                        kCGEventMaskForAllEvents,
                                        KeyboardEventTapCallback, nullptr);
  if (!g_eventTap) return false;

  CFRunLoopSourceRef source =
      CFMachPortCreateRunLoopSource(kCFAllocatorDefault, (CFMachPortRef)g_eventTap, 0);
  if (!source) {
    CFRelease(g_eventTap);
    g_eventTap = nullptr;
    return false;
  }

  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
  CFRelease(source);

  return true;
}

static void StopEventTap() {
  if (g_eventTap) {
    CFRunLoopSourceInvalidate((CFRunLoopSourceRef)(void*)g_eventTap);
    CFRelease(g_eventTap);
    g_eventTap = nullptr;
  }
}

static napi_value StartFn(napi_env env, napi_callback_info info) {
  (void)info;
  bool ok = StartEventTap();
  napi_value result;
  napi_get_boolean(env, ok, &result);
  return result;
}

static napi_value StopFn(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  StopEventTap();
  return nullptr;
}

static napi_value GetCountsFn(napi_env env, napi_callback_info info) {
  (void)info;
  int64_t down = g_keyDownCount.exchange(0, std::memory_order_relaxed);
  int64_t up = g_keyUpCount.exchange(0, std::memory_order_relaxed);

  napi_value obj;
  napi_create_object(env, &obj);

  napi_value downVal, upVal;
  napi_create_int64(env, (int64_t)down, &downVal);
  napi_create_int64(env, (int64_t)up, &upVal);

  napi_set_named_property(env, obj, "keyDown", downVal);
  napi_set_named_property(env, obj, "keyUp", upVal);

  return obj;
}

static napi_value IsRunningFn(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_get_boolean(env, g_eventTap != nullptr, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"start", NULL, StartFn, NULL, NULL, NULL, napi_default, NULL},
      {"stop", NULL, StopFn, NULL, NULL, NULL, napi_default, NULL},
      {"getCounts", NULL, GetCountsFn, NULL, NULL, NULL, napi_default, NULL},
      {"isRunning", NULL, IsRunningFn, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, 4, props);
  return exports;
}

NAPI_MODULE(keyboard_addon, Init)
