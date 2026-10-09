#include <js.h>

static js_value_t *
trap(js_env_t *env, js_callback_info_t *info) {
  __builtin_trap();
}

js_value_t *
bare_register_module_v0(js_env_t *env, js_value_t *exports) {
  js_value_t *fn;
  js_create_function(env, "trap", -1, trap, NULL, &fn);
  js_set_named_property(env, exports, "trap", fn);

  return exports;
}
