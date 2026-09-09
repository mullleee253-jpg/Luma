cmake_minimum_required(VERSION 3.20)
project(luma_archive VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(luma-archive native/main.cpp)
if (MSVC)
  target_compile_options(luma-archive PRIVATE /W4 /O2)
else()
  target_compile_options(luma-archive PRIVATE -Wall -Wextra -Wpedantic -O2)
endif()