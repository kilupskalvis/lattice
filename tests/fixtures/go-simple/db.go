package simple

import "fmt"

// @lattice:boundary postgres
func SaveOrder(data string) {
	fmt.Println("saving", data)
}
