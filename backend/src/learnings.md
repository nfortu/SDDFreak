learnings.md

- app code generation fro mspecs document replicates all requirements IDs into comment all over the code, this could be a good thing to track requirements but I think is overkill, no need to document where the requiermens where fullfilled. A better approach is to reflexct requirement validation with unit tests, keep code coments but without the FR-1... or whatever requirement key is the case.

