#include <array>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <queue>
#include <string>
#include <vector>

namespace {
constexpr std::array<char, 8> magic{'L', 'U', 'M', 'A', 'A', 'R', 'C', '1'};
struct Node { uint64_t frequency; int symbol; Node* left; Node* right; };
struct NodeOrder { bool operator()(const Node* a, const Node* b) const { return a->frequency == b->frequency ? a->symbol > b->symbol : a->frequency > b->frequency; } };
using Bytes = std::vector<uint8_t>;

uint32_t crc32(const Bytes& data) {
  uint32_t crc = 0xFFFFFFFFu;
  for (uint8_t byte : data) { crc ^= byte; for (int bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u))); }
  return ~crc;
}

template <typename T> void writeLittle(std::ostream& output, T value) { for (size_t i = 0; i < sizeof(T); ++i) output.put(static_cast<char>((value >> (i * 8)) & 0xFFu)); }
template <typename T> bool readLittle(std::istream& input, T& value) { value = 0; for (size_t i = 0; i < sizeof(T); ++i) { const int byte = input.get(); if (byte == EOF) return false; value |= static_cast<T>(static_cast<uint8_t>(byte)) << (i * 8); } return true; }

void makeLengths(const std::array<uint64_t, 256>& frequencies, std::array<uint8_t, 256>& lengths) {
  lengths.fill(0); std::vector<Node> nodes; nodes.reserve(512); std::priority_queue<Node*, std::vector<Node*>, NodeOrder> queue;
  for (int symbol = 0; symbol < 256; ++symbol) if (frequencies[symbol]) { nodes.push_back({frequencies[symbol], symbol, nullptr, nullptr}); queue.push(&nodes.back()); }
  if (queue.empty()) return;
  if (queue.size() == 1) { lengths[static_cast<uint8_t>(queue.top()->symbol)] = 1; return; }
  while (queue.size() > 1) { Node* first = queue.top(); queue.pop(); Node* second = queue.top(); queue.pop(); nodes.push_back({first->frequency + second->frequency, -1, first, second}); queue.push(&nodes.back()); }
  std::vector<std::pair<Node*, uint8_t>> pending{{queue.top(), static_cast<uint8_t>(0)}};
  while (!pending.empty()) { const auto [node, depth] = pending.back(); pending.pop_back(); if (node->symbol >= 0) lengths[static_cast<uint8_t>(node->symbol)] = std::max<uint8_t>(depth, 1); else { pending.push_back({node->right, static_cast<uint8_t>(depth + 1)}); pending.push_back({node->left, static_cast<uint8_t>(depth + 1)}); } }
}

struct Code { uint64_t bits = 0; uint8_t length = 0; };
std::array<Code, 256> canonicalCodes(const std::array<uint8_t, 256>& lengths) {
  std::array<Code, 256> codes{}; std::array<uint16_t, 256> count{}; for (uint8_t length : lengths) if (length) ++count[length];
  uint64_t next = 0; std::array<uint64_t, 256> first{}; for (size_t length = 1; length < 256; ++length) { next = (next + count[length - 1]) << 1; first[length] = next; }
  for (size_t symbol = 0; symbol < 256; ++symbol) { const uint8_t length = lengths[symbol]; if (length) codes[symbol] = {first[length]++, length}; }
  return codes;
}

Bytes encode(const Bytes& input, const std::array<Code, 256>& codes) {
  Bytes output; uint8_t current = 0; int bits = 0;
  for (uint8_t byte : input) { const Code code = codes[byte]; for (int bit = code.length - 1; bit >= 0; --bit) { current = static_cast<uint8_t>((current << 1) | ((code.bits >> bit) & 1u)); if (++bits == 8) { output.push_back(current); current = 0; bits = 0; } } }
  if (bits) output.push_back(static_cast<uint8_t>(current << (8 - bits))); return output;
}

Bytes encodeRle(const Bytes& input) {
  Bytes output;
  size_t position = 0;
  while (position < input.size()) {
    const uint8_t value = input[position];
    size_t end = position + 1;
    while (end < input.size() && input[end] == value) ++end;
    output.push_back(value);
    const uint64_t count = static_cast<uint64_t>(end - position);
    for (size_t byte = 0; byte < sizeof(count); ++byte) output.push_back(static_cast<uint8_t>((count >> (byte * 8)) & 0xFFu));
    position = end;
  }
  return output;
}

bool readFile(const std::string& path, Bytes& data) { std::ifstream input(path, std::ios::binary); if (!input) return false; input.seekg(0, std::ios::end); const auto size = input.tellg(); if (size < 0) return false; input.seekg(0, std::ios::beg); data.resize(static_cast<size_t>(size)); return data.empty() || static_cast<bool>(input.read(reinterpret_cast<char*>(data.data()), size)); }

bool pack(const std::string& source, const std::string& destination) {
  Bytes input; if (!readFile(source, input)) { std::cerr << "Cannot read input file\n"; return false; }
  std::array<uint64_t, 256> frequencies{}; for (uint8_t byte : input) ++frequencies[byte]; std::array<uint8_t, 256> lengths{}; makeLengths(frequencies, lengths); const Bytes compressed = encode(input, canonicalCodes(lengths)); const Bytes rle = encodeRle(input);
  uint8_t method = 0; const Bytes* payload = &compressed;
  if (rle.size() < payload->size()) { method = 2; payload = &rle; }
  if (input.size() <= payload->size()) { method = 1; payload = &input; }
  std::ofstream output(destination, std::ios::binary); if (!output) { std::cerr << "Cannot create output file\n"; return false; }
  output.write(magic.data(), 8); output.put(static_cast<char>(method)); output.put(0); writeLittle<uint64_t>(output, input.size()); writeLittle<uint32_t>(output, crc32(input)); for (uint8_t length : lengths) output.put(static_cast<char>(length));
  output.write(reinterpret_cast<const char*>(payload->data()), static_cast<std::streamsize>(payload->size()));
  if (!output) return false; const double ratio = input.empty() ? 1.0 : static_cast<double>(output.tellp()) / input.size(); const char* methodName = method == 1 ? "raw" : method == 2 ? "RLE" : "Huffman"; std::cout << "Packed " << input.size() << " -> " << output.tellp() << " bytes (" << std::fixed << std::setprecision(2) << ratio * 100.0 << "% of original, " << methodName << ")\n"; return true;
}

bool unpack(const std::string& source, const std::string& destination) {
  std::ifstream input(source, std::ios::binary); if (!input) return false; std::array<char, 8> fileMagic{}; if (!input.read(fileMagic.data(), 8) || fileMagic != magic) { std::cerr << "Invalid Luma archive\n"; return false; }
  const int raw = input.get(); input.get(); uint64_t originalSize = 0; uint32_t expectedCrc = 0; if (raw == EOF || !readLittle(input, originalSize) || !readLittle(input, expectedCrc)) return false;
  std::array<uint8_t, 256> lengths{}; for (uint8_t& length : lengths) { const int value = input.get(); if (value == EOF) return false; length = static_cast<uint8_t>(value); } Bytes encoded((std::istreambuf_iterator<char>(input)), {}); Bytes output;
  if (raw == 1) output = std::move(encoded); else if (raw == 2) { for (size_t position = 0; position + 8 < encoded.size();) { const uint8_t value = encoded[position++]; uint64_t count = 0; for (size_t byte = 0; byte < sizeof(count); ++byte) count |= static_cast<uint64_t>(encoded[position++]) << (byte * 8); if (count > originalSize - output.size()) return false; output.insert(output.end(), static_cast<size_t>(count), value); } } else { const auto codes = canonicalCodes(lengths); struct Entry { uint64_t bits; uint8_t length; uint8_t symbol; }; std::vector<Entry> entries; for (int symbol = 0; symbol < 256; ++symbol) if (lengths[symbol]) entries.push_back({codes[symbol].bits, lengths[symbol], static_cast<uint8_t>(symbol)}); uint64_t bits = 0; uint8_t length = 0; for (uint8_t byte : encoded) for (int bit = 7; bit >= 0 && output.size() < originalSize; --bit) { bits = (bits << 1) | ((byte >> bit) & 1u); ++length; for (const auto entry : entries) if (entry.length == length && entry.bits == bits) { output.push_back(entry.symbol); bits = 0; length = 0; break; } } }
  if (output.size() != originalSize || crc32(output) != expectedCrc) { std::cerr << "Archive integrity check failed\n"; return false; } std::ofstream result(destination, std::ios::binary); if (!result) return false; result.write(reinterpret_cast<const char*>(output.data()), static_cast<std::streamsize>(output.size())); std::cout << "Unpacked " << output.size() << " bytes; CRC32 verified\n"; return static_cast<bool>(result);
}
}

int main(int argc, char** argv) {
  if (argc != 4 || (std::string(argv[1]) != "pack" && std::string(argv[1]) != "unpack")) {
    std::cout << "Luma Archive - lossless binary compressor\n\n"
              << "Usage:\n"
              << "  luma-archive.exe pack <input> <archive.luma>\n"
              << "  luma-archive.exe unpack <archive.luma> <output>\n\n"
              << "Close this window with Enter.\n";
    std::cin.get();
    return argc == 1 ? 0 : 2;
  }
  return std::string(argv[1]) == "pack" ? !pack(argv[2], argv[3]) : !unpack(argv[2], argv[3]);
}