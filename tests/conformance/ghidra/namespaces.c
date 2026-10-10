// Emit C++ ABI names with the host C compiler; no C++ runtime is required.
#if defined(__APPLE__)
#define REA_CPP_SYMBOL(name) "_" name
#else
#define REA_CPP_SYMBOL(name) name
#endif

volatile int rea_namespace_alpha_value
    __asm__(REA_CPP_SYMBOL("_ZN5alpha5valueE")) = 3;
volatile int rea_namespace_nested_value
    __asm__(REA_CPP_SYMBOL("_ZN5outer5inner5valueE")) = 1;
volatile int rea_name_data_first = 5;
volatile int rea_name_data_second = 9;

__attribute__((noinline, used)) int rea_name_first(int value) {
  return value + rea_name_data_first;
}
__attribute__((noinline, used)) int rea_name_second(int value) {
  return value + rea_name_data_second;
}

__attribute__((noinline, used)) int rea_namespace_alpha(int value)
    __asm__(REA_CPP_SYMBOL("_ZN5alpha4sameEi"));
__attribute__((noinline, used)) int rea_namespace_beta(int value)
    __asm__(REA_CPP_SYMBOL("_ZN4beta4sameEi"));
__attribute__((noinline, used)) int rea_namespace_nested(int value)
    __asm__(REA_CPP_SYMBOL("_ZN5outer5inner4sameEi"));

int rea_namespace_alpha(int value) { return value + rea_namespace_alpha_value; }
int rea_namespace_beta(int value) { return value * 2; }
int rea_namespace_nested(int value) { return value - rea_namespace_nested_value; }

int main(void) {
  return rea_namespace_alpha(1) + rea_namespace_beta(2) +
         rea_namespace_nested(3) + rea_name_first(4) + rea_name_second(5);
}
