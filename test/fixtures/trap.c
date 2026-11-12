#include <js.h>

static js_value_t *
trap(js_env_t *env, js_callback_info_t *info) {
  __builtin_trap();
}

static js_value_t *
invoke(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  js_value_t *receiver;
  js_get_undefined(env, &receiver);

  js_value_t *error;
  if (js_call_function(env, receiver, argv[0], 0, NULL, NULL) < 0) {
    js_get_and_clear_last_exception(env, &error);
  }

  js_value_t *result;
  js_create_string_utf8(env, (const utf8_t *) "continued", -1, &result);

  return result;
}

js_value_t *
bare_register_module_v0(js_env_t *env, js_value_t *exports) {
  js_value_t *fn;

  js_create_function(env, "trap", -1, trap, NULL, &fn);
  js_set_named_property(env, exports, "trap", fn);

  js_create_function(env, "invoke", -1, invoke, NULL, &fn);
  js_set_named_property(env, exports, "invoke", fn);

  return exports;
}
