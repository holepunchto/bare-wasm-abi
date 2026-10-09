cmake_minimum_required(VERSION 4.0)

find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)

project(bare_wasm_abi C)

if(NOT CMAKE_SYSTEM_NAME STREQUAL "WASI")
  message(FATAL_ERROR "Configure with the 'wasi-wasm32' toolchain from 'cmake-toolchains'")
endif()

fetch_package(
  "github:holepunchto/libutf#a1ceca8"
  SOURCE_DIR libutf
  SOURCE_SUBDIR fetch-only
)

fetch_package(
  "github:holepunchto/libjs#d143cf2"
  SOURCE_DIR libjs
  SOURCE_SUBDIR fetch-only
)

set(include "${libjs}/include" "${libutf}/include")

list(JOIN include "\", \"" headers)

file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/headers.json" "[\"${headers}\"]\n")

file(GLOB fixtures CONFIGURE_DEPENDS test/fixtures/*.c)

foreach(source IN LISTS fixtures)
  cmake_path(GET source STEM name)

  add_executable(${name} "${source}")

  target_include_directories(${name} PRIVATE ${include})

  target_link_options(
    ${name}
    PRIVATE
      -mexec-model=reactor
      -Wl,--allow-undefined
      -Wl,--export=bare_register_module_v0
      -Wl,--export=malloc
      -Wl,--export=free
      -Wl,--export-table
  )
endforeach()
