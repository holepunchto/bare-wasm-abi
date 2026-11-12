#include <js.h>
#include <stddef.h>

static js_value_t *
noop(js_env_t *env, js_callback_info_t *info) {
  return NULL;
}

static js_value_t *
create(js_env_t *env, js_callback_info_t *info) {
  js_value_t *result;
  js_create_object(env, &result);

  js_value_t *value;

#define V(name) js_set_named_property(env, result, name, value);

  js_create_object(env, &value);
  V("object")

  js_value_t *prototype = value;
  js_create_object_with_prototype(env, prototype, &value);
  V("objectWithPrototype")

  js_create_array(env, &value);
  V("array")

  js_create_array_with_length(env, 2, &value);
  V("arrayWithLength")

  js_value_t *elements[] = {prototype};
  js_create_array_with_elements(env, elements, 1, &value);
  V("arrayWithElements")

  js_get_property_names(env, prototype, &value);
  V("propertyNames")

  js_create_function(env, "noop", -1, noop, NULL, &value);
  V("function")

  js_value_t *class;
  js_define_class(env, "Class", -1, noop, NULL, NULL, 0, &class);
  value = class;
  V("class")

  js_new_instance(env, class, 0, NULL, &value);
  V("instance")

  js_create_date(env, 0, &value);
  V("date")

  js_create_error(env, NULL, NULL, &value);
  V("error")

  js_create_type_error(env, NULL, NULL, &value);
  V("typeError")

  js_deferred_t *deferred;
  js_create_promise(env, &deferred, &value);
  V("promise")

  js_value_t *undefined;
  js_get_undefined(env, &undefined);
  js_resolve_deferred(env, deferred, undefined);

  js_value_t *arraybuffer;
  js_create_arraybuffer(env, 8, NULL, &arraybuffer);
  value = arraybuffer;
  V("arraybuffer")

  js_create_typedarray(env, js_uint8array, 8, arraybuffer, 0, &value);
  V("typedarray")

  js_create_dataview(env, 8, arraybuffer, 0, &value);
  V("dataview")

  js_value_t *number;
  js_create_int32(env, 42, &number);
  js_coerce_to_object(env, number, &value);
  V("numberObject")

  js_get_global(env, &value);
  V("global")

#undef V

  return result;
}

static js_value_t *
misuse(js_env_t *env, js_callback_info_t *info) {
  js_value_t *string;
  js_create_string_utf8(env, (const utf8_t *) "not a number", -1, &string);

  int32_t value;
  js_get_value_int32(env, string, &value);

  js_value_t *error;
  js_get_and_clear_last_exception(env, &error);

  return error;
}

static js_value_t *
out_of_bounds(js_env_t *env, js_callback_info_t *info) {
  js_value_t *number;
  js_create_int32(env, 42, &number);

  js_get_value_int32(env, number, (int32_t *) 0xfffffff0);

  js_value_t *error;
  js_get_and_clear_last_exception(env, &error);

  return error;
}

static js_value_t *
identity(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  if (js_get_callback_info(env, info, &argc, argv, NULL, NULL) < 0) return NULL;

  return argv[0];
}

static js_value_t *
global_of(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  if (js_get_callback_info(env, info, &argc, argv, NULL, NULL) < 0) return NULL;

  js_value_t *result;
  if (js_get_object_global(env, argv[0], &result) < 0) return NULL;

  return result;
}

static js_value_t *
run(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  if (js_get_callback_info(env, info, &argc, argv, NULL, NULL) < 0) return NULL;

  js_value_t *result;
  if (js_run_script(env, "script.js", 9, 10, argv[0], &result) < 0) return NULL;

  return result;
}

static js_value_t *
run_prepared(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  if (js_get_callback_info(env, info, &argc, argv, NULL, NULL) < 0) return NULL;

  js_script_t *script;
  if (js_prepare_script(env, "prepared.js", -1, 0, argv[0], &script) < 0) return NULL;

  js_value_t *first, *second;
  if (js_run_prepared_script(env, script, &first) < 0) return NULL;
  if (js_run_prepared_script(env, script, &second) < 0) return NULL;

  const char *name;
  js_get_script_name(env, script, &name);

  js_value_t *file;
  js_create_string_utf8(env, (const utf8_t *) name, -1, &file);

  js_delete_script(env, script);

  js_value_t *elements[] = {first, second, file};

  js_value_t *result;
  js_create_array_with_elements(env, elements, 3, &result);

  return result;
}

static js_value_t *
compile(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  if (js_get_callback_info(env, info, &argc, argv, NULL, NULL) < 0) return NULL;

  js_value_t *args[2];
  js_create_string_utf8(env, (const utf8_t *) "a", -1, &args[0]);
  js_create_string_utf8(env, (const utf8_t *) "b", -1, &args[1]);

  js_value_t *result;
  if (js_compile_function(env, "add", -1, "function.js", -1, args, 2, 5, argv[0], &result) < 0) return NULL;

  return result;
}

static void
clear(js_env_t *env) {
  bool pending;
  js_is_exception_pending(env, &pending);

  if (pending) {
    js_value_t *error;
    js_get_and_clear_last_exception(env, &error);
  }
}

static js_value_t *
operate(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 8;
  js_value_t *argv[8];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  js_value_t *target = argv[0], *key, *one, *object, *result, *elements[2];
  js_create_string_utf8(env, (const utf8_t *) "key", -1, &key);
  js_create_int32(env, 1, &one);
  js_create_object(env, &object);

  bool flag;
  uint32_t len;

  js_get_property(env, target, key, &result);
  clear(env);
  js_set_property(env, target, key, one);
  clear(env);
  js_has_property(env, target, key, &flag);
  clear(env);
  js_has_own_property(env, target, key, &flag);
  clear(env);
  js_delete_property(env, target, key, &flag);
  clear(env);
  js_get_property_names(env, target, &result);
  clear(env);
  js_get_filtered_property_names(env, target, js_key_include_prototypes, js_writable, js_index_include_indices, js_key_convert_to_string, &result);
  clear(env);

  js_property_descriptor_t property = {
    .version = 0,
    .name = key,
    .attributes = js_writable | js_enumerable | js_configurable,
    .value = one,
  };
  js_define_properties(env, target, &property, 1);
  clear(env);

  js_coerce_to_string(env, target, &result);
  clear(env);
  js_coerce_to_number(env, target, &result);
  clear(env);
  js_instanceof(env, object, target, &flag);
  clear(env);
  js_call_function(env, target, target, 1, &one, &result);
  clear(env);
  js_new_instance(env, target, 1, &one, &result);
  clear(env);
  js_get_array_length(env, target, &len);
  clear(env);
  js_get_array_elements(env, target, elements, 2, 0, &len);
  clear(env);
  js_set_array_elements(env, target, &one, 1, 0);
  clear(env);
  js_get_prototype(env, target, &result);
  clear(env);
  js_set_prototype(env, target, result);
  clear(env);
  js_throw_error(env, "CODE", "message");
  clear(env);
  js_freeze(env, target);
  clear(env);

  return NULL;
}

static js_value_t *
fatal(js_env_t *env, js_callback_info_t *info) {
  js_value_t *error = run(env, info);
  if (error == NULL) return NULL;

  js_fatal_exception(env, error);

  return NULL;
}

js_value_t *
bare_register_module_v0(js_env_t *env, js_value_t *exports) {
  js_value_t *fn;

  js_create_function(env, "create", -1, create, NULL, &fn);
  js_set_named_property(env, exports, "create", fn);

  js_create_function(env, "misuse", -1, misuse, NULL, &fn);
  js_set_named_property(env, exports, "misuse", fn);

  js_create_function(env, "outOfBounds", -1, out_of_bounds, NULL, &fn);
  js_set_named_property(env, exports, "outOfBounds", fn);

  js_create_function(env, "identity", -1, identity, NULL, &fn);
  js_set_named_property(env, exports, "identity", fn);

  js_create_function(env, "globalOf", -1, global_of, NULL, &fn);
  js_set_named_property(env, exports, "globalOf", fn);

  js_create_function(env, "run", -1, run, NULL, &fn);
  js_set_named_property(env, exports, "run", fn);

  js_create_function(env, "runPrepared", -1, run_prepared, NULL, &fn);
  js_set_named_property(env, exports, "runPrepared", fn);

  js_create_function(env, "compile", -1, compile, NULL, &fn);
  js_set_named_property(env, exports, "compile", fn);

  js_create_function(env, "fatal", -1, fatal, NULL, &fn);
  js_set_named_property(env, exports, "fatal", fn);

  js_create_function(env, "operate", -1, operate, NULL, &fn);
  js_set_named_property(env, exports, "operate", fn);

  return exports;
}
