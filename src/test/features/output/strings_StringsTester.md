# TACT Compilation Report
Contract: StringsTester
BOC Size: 2279 bytes

# Types
Total Types: 3

## StateInit
TLB: _ code:^cell data:^cell = StateInit

## Context
TLB: _ bounced:bool sender:address value:int257 raw:^slice = Context

## SendParameters
TLB: _ bounce:bool to:address value:int257 mode:int257 body:Maybe ^cell code:Maybe ^cell data:Maybe ^cell = SendParameters

# Get Methods
Total Get Methods: 13

## constantString

## constantStringUnicode

## constantStringUnicodeLong

## dynamicStringCell

## dynamicCommentCell

## dynamicCommentCellLarge

## dynamicCommentStringLarge

## stringWithNumber

## stringWithNegativeNumber

## stringWithLargeNumber

## stringWithFloat

## base64

## processBase64
Argument: src