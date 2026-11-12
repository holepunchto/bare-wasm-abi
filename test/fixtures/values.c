#include <js.h>
#include <stdlib.h>
#include <string.h>

static js_value_t *
add(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  int32_t a, b;
  js_get_value_int32(env, argv[0], &a);
  js_get_value_int32(env, argv[1], &b);

  js_value_t *result;
  js_create_int32(env, a + b, &result);

  return result;
}

static js_value_t *
scale(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  double x, factor;
  js_get_value_double(env, argv[0], &x);
  js_get_value_double(env, argv[1], &factor);

  js_value_t *result;
  js_create_double(env, x * factor, &result);

  return result;
}

static js_value_t *
negate(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  int64_t value;
  bool lossless;
  js_get_value_bigint_int64(env, argv[0], &value, &lossless);

  js_value_t *result;
  js_create_bigint_int64(env, -value, &result);

  return result;
}

static utf8_t *
utf8(js_env_t *env, js_value_t *value, size_t *len) {
  js_get_value_string_utf8(env, value, NULL, 0, len);

  utf8_t *str = malloc(*len + 1);
  js_get_value_string_utf8(env, value, str, *len + 1, NULL);

  return str;
}

static js_value_t *
concat(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  size_t a_len, b_len;
  utf8_t *a = utf8(env, argv[0], &a_len);
  utf8_t *b = utf8(env, argv[1], &b_len);

  utf8_t *str = malloc(a_len + b_len);
  memcpy(str, a, a_len);
  memcpy(str + a_len, b, b_len);

  js_value_t *result;
  js_create_string_utf8(env, str, a_len + b_len, &result);

  free(a);
  free(b);
  free(str);

  return result;
}

static js_value_t *
reverse(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  size_t len;
  js_get_value_string_utf16le(env, argv[0], NULL, 0, &len);

  utf16_t *str = malloc(len * sizeof(utf16_t));
  js_get_value_string_utf16le(env, argv[0], str, len, NULL);

  for (size_t i = 0, j = len - 1; i < j; i++, j--) {
    utf16_t c = str[i];
    str[i] = str[j];
    str[j] = c;
  }

  js_value_t *result;
  js_create_string_utf16le(env, str, len, &result);

  free(str);

  return result;
}

static js_value_t *
pair(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  size_t len;
  utf8_t *key = utf8(env, argv[0], &len);

  js_value_t *result;
  js_create_object(env, &result);
  js_set_named_property(env, result, (char *) key, argv[1]);

  free(key);

  return result;
}

static js_value_t *
invoke(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  js_value_t *receiver;
  js_get_undefined(env, &receiver);

  js_value_t *result;
  int err = js_call_function(env, receiver, argv[0], 1, &argv[1], &result);
  if (err < 0) return NULL;

  return result;
}

static js_value_t *
fail(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  size_t len;
  utf8_t *message = utf8(env, argv[0], &len);

  js_throw_error(env, "ERR_FIXTURE", (char *) message);

  free(message);

  return NULL;
}

static js_value_t *
fill(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  uint8_t *data;
  size_t len;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &data, &len, NULL, NULL);

  int32_t byte;
  js_get_value_int32(env, argv[1], &byte);

  memset(data, byte, len);

  return NULL;
}

static js_value_t *
type_of(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  js_value_type_t type;
  js_typeof(env, argv[0], &type);

  static const char *names[] = {
    [js_undefined] = "undefined",
    [js_null] = "null",
    [js_boolean] = "boolean",
    [js_number] = "number",
    [js_string] = "string",
    [js_symbol] = "symbol",
    [js_object] = "object",
    [js_function] = "function",
    [js_external] = "external",
    [js_bigint] = "bigint",
  };

  js_value_t *result;
  js_create_string_utf8(env, (const utf8_t *) names[type], -1, &result);

  return result;
}

static js_value_t *
is_detachable(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  bool detachable;
  js_is_detachable_arraybuffer(env, argv[0], &detachable);

  js_value_t *result;
  js_get_boolean(env, detachable, &result);

  return result;
}

static js_value_t *
object_type(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  js_value_t *value = argv[0];

  bool is_undefined;
  js_is_undefined(env, value, &is_undefined);
  if (is_undefined) js_create_external(env, NULL, NULL, NULL, &value);

  js_object_type_t type;
  if (js_get_object_type(env, value, &type) < 0) return NULL;

  js_value_t *result;
  js_create_uint32(env, type, &result);

  return result;
}

static js_value_t *
iterator_kind(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  bool is_map_iterator, is_set_iterator;
  js_is_map_iterator(env, argv[0], &is_map_iterator);
  js_is_set_iterator(env, argv[0], &is_set_iterator);

  const char *kind = is_map_iterator ? "map" : is_set_iterator ? "set" : "none";

  js_value_t *result;
  js_create_string_utf8(env, (const utf8_t *) kind, -1, &result);

  return result;
}

static js_value_t *
observe(js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];
  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  uint8_t *data;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &data, NULL, NULL, NULL);

  data[0] = 1;

  js_value_t *seen;
  js_get_named_property(env, argv[1], "probe", &seen);

  js_value_t *written;
  js_create_uint32(env, data[1], &written);

  js_value_t *elements[] = {seen, written};

  js_value_t *result;
  js_create_array_with_elements(env, elements, 2, &result);

  return result;
}

js_value_t *
bare_register_module_v0(js_env_t *env, js_value_t *exports) {
  struct {
    const char *name;
    js_function_cb cb;
  } functions[] = {
    {"add", add},
    {"scale", scale},
    {"negate", negate},
    {"concat", concat},
    {"reverse", reverse},
    {"pair", pair},
    {"invoke", invoke},
    {"fail", fail},
    {"fill", fill},
    {"typeOf", type_of},
    {"isDetachable", is_detachable},
    {"objectType", object_type},
    {"iteratorKind", iterator_kind},
    {"observe", observe},
  };

  for (size_t i = 0; i < sizeof(functions) / sizeof(functions[0]); i++) {
    js_value_t *fn;
    js_create_function(env, functions[i].name, -1, functions[i].cb, NULL, &fn);
    js_set_named_property(env, exports, functions[i].name, fn);
  }

  return exports;
}
