#include <js.h>
#include <stdint.h>
#include <stdio.h>

static void
on_teardown(void *data) {
  printf("%d\n", (int) (intptr_t) data);
  fflush(stdout);
}

static int32_t
id(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  int32_t id;
  js_get_value_int32(env, argv[0], &id);

  return id;
}

static js_value_t *
add_teardown(js_env_t *env, js_callback_info_t *info) {
  js_add_teardown_callback(env, on_teardown, (void *) (intptr_t) id(env, info));

  return NULL;
}

static js_value_t *
remove_teardown(js_env_t *env, js_callback_info_t *info) {
  js_remove_teardown_callback(env, on_teardown, (void *) (intptr_t) id(env, info));

  return NULL;
}

js_value_t *
bare_register_module_v0(js_env_t *env, js_value_t *exports) {
  js_value_t *fn;

  js_create_function(env, "addTeardown", -1, add_teardown, NULL, &fn);
  js_set_named_property(env, exports, "addTeardown", fn);

  js_create_function(env, "removeTeardown", -1, remove_teardown, NULL, &fn);
  js_set_named_property(env, exports, "removeTeardown", fn);

  return exports;
}
